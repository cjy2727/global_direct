import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { AiService, mergeAiEvidence, collectEvidence } from '../ai.js';
import { JobManager } from '../jobs.js';
import { applyOptionFallback } from '../option-fallback.js';
import { chromium } from 'playwright';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'globaldirect-fixture-'));
const config = loadConfig({ AI_USAGE_FILE: path.join(dir, 'usage.json') });
const product = { title: 'Fixture', price: null, currency: 'UNKNOWN', optionGroups: [], optionAnalysis: { status: 'unresolved' }, status: 'needs_review', images: [], description: '' };
const evidence = { text: 'Fixture sale price USD 120. Color red blue. Coupon 10% for members.', images: ['https://example.test/item.jpg'], controls: [{ name: 'Color', choices: ['red', 'blue'] }] };
try {
  assert.throws(() => loadConfig({ AI_ENABLED: 'yes' }));
  assert.throws(() => loadConfig({ ANALYSIS_CONCURRENCY: '1.5' }));
  let calls = 0;
  const disabled = new AiService(config, { fetchImpl: async () => { calls++; } });
  assert.equal((await disabled.enrich(product, evidence)).aiAnalysis.reason, 'disabled');
  assert.equal(calls, 0);
  const fallback = applyOptionFallback(product, evidence);
  assert.equal(fallback.optionFallback.fields[0].name, 'Color');
  assert.equal(fallback.optionFallback.priceConfirmed, false);
  assert.equal(applyOptionFallback({ ...product, optionAnalysis: { status: 'none' } }).optionFallback.fields.length, 0);
  assert.equal(applyOptionFallback(product).optionFallback.fields[0].name, '옵션·요청사항');
  const merged = mergeAiEvidence(product, evidence, { claims: [
    { kind: 'price', value: '120', evidence: 'sale price USD 120' },
    { kind: 'title', value: 'Wrong', evidence: 'Wrong' },
    { kind: 'image', value: 'https://evil.test/x.jpg', evidence: '' },
    { kind: 'discount', value: '10%', evidence: 'Coupon 10% for members.' },
  ], options: [{ name: 'Color', evidence: 'Color red blue', values: ['red', 'invented'] }] });
  assert.equal(merged.title, 'Fixture'); assert.equal(merged.price, 120);
  assert.deepEqual(merged.images, []); assert.equal(merged.optionGroups[0].values.length, 1);
  assert.equal(merged.status, 'needs_review');
  assert.equal(mergeAiEvidence(product, { ...evidence, text: 'Price 1200' }, { claims: [{ kind: 'price', value: '200', evidence: 'Price 1200' }], options: [] }).price, null);
  assert.equal(applyOptionFallback(product, { controls: [{ name: '' }] }).optionFallback.fields[0].name, '옵션 직접 입력');
  assert.equal(applyOptionFallback(product, { controls: [{ name: 'Color / Size' }] }).optionFallback.fields.length, 2);
  const enabledConfig = { ...config, aiEnabled: true, apiKey: 'fixture-key', model: 'fixture-model', inputPrice: 1, outputPrice: 2, dailyRequests: 1 };
  const mock = async (url, init) => {
    calls++;
    assert.equal(url.href, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(init.body); assert.equal(body.store, false); assert.equal(body.text.format.strict, true);
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 10, output_tokens: 10 }, output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ claims: [], options: [] }) }] }] }));
  };
  const ai = new AiService(enabledConfig, { fetchImpl: mock });
  assert.equal((await ai.enrich(product, evidence)).aiAnalysis.status, 'success');
  assert.equal((await ai.enrich(product, evidence)).aiAnalysis.reason, 'daily_request_limit');
  const restarted = new AiService(enabledConfig, { fetchImpl: mock });
  assert.equal((await restarted.enrich(product, evidence)).aiAnalysis.reason, 'daily_request_limit');
  assert.equal(calls, 1);
  const budget = new AiService({ ...enabledConfig, stateFile: path.join(dir, 'budget.json'), dailyBudget: 0 }, { fetchImpl: mock });
  assert.equal((await budget.enrich(product, evidence)).aiAnalysis.reason, 'daily_budget');
  const failing = new AiService({ ...enabledConfig, stateFile: path.join(dir, 'failure.json') }, { fetchImpl: async () => new Response('error', { status: 429 }) });
  assert.equal((await failing.enrich(product, evidence)).aiAnalysis.reason, 'provider_limit');
  const slow = new AiService({ ...enabledConfig, stateFile: path.join(dir, 'slow.json'), aiTimeout: 10 }, { fetchImpl: async (_, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancel')))) });
  assert.equal((await slow.enrich(product, evidence)).aiAnalysis.reason, 'timeout_or_cancelled');

  let release; let executions = 0;
  const jobs = new JobManager({ ...config, rateEnabled: false, queueMax: 1 }, async () => {
    executions++; if (executions === 1) await new Promise(resolve => { release = resolve; }); return product;
  });
  const first = jobs.submit('https://example.test/item?utm_source=test');
  const duplicate = jobs.submit('https://example.test/item'); assert.equal(duplicate.id, first.id);
  const second = jobs.submit('https://example.test/second');
  assert.throws(() => jobs.submit('https://example.test/third'), /대기열/);
  await new Promise(resolve => setImmediate(resolve)); release();
  await Promise.all([first.promise, second.promise]);
  assert.equal(executions, 2); assert.equal(first.state, 'completed');
  const cached = jobs.submit('https://example.test/item'); assert.equal(cached.product.cacheAnalysis.hit, true);
  const rate = new JobManager({ ...config, perIp: 1 }, async () => product);
  rate.submit('https://example.test/a', { ip: 'fixture' });
  assert.throws(() => rate.submit('https://example.test/b', { ip: 'fixture' }), /요청 한도/);
  const timeout = new JobManager({ ...config, rateEnabled: false, timeout: 10 }, async (_, signal) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('abort')))));
  const timed = timeout.submit('https://example.test/slow'); await timed.promise;
  assert.equal(timed.error.code, 'analysis_timeout'); assert.equal(timeout.running, 0);
  const waiting = new JobManager({ ...config, rateEnabled: false, queueWait: 10 }, async () => new Promise(resolve => { release = resolve; }));
  const active = waiting.submit('https://example.test/active'); const expired = waiting.submit('https://example.test/wait');
  await expired.promise; assert.equal(expired.error.code, 'queue_timeout'); release(product); await active.promise;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<main><h1>Fixture</h1><input value="private-value"><textarea>private-text</textarea><script>const secret="private-script"</script><p>Sales a@example.test</p><select><option value="">Color</option><option>Red</option></select><img src="https://example.test/a.jpg"></main>');
    const captured = await page.evaluate(collectEvidence);
    assert(!JSON.stringify(captured).includes('private-')); assert(!captured.text.includes('a@example.test'));
    assert.equal(captured.controls[0].name, 'Color');
  } finally { await browser.close(); }
  console.log('PASS: AI disabled/mock/validation/usage persistence/budget/failure/timeout, fallback, concurrency/dedup/cache/rate/queue timeout, evidence privacy');
} finally {
  // Only this test's generated temporary fixture files.
  for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir);
}
