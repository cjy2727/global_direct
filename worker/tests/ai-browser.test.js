import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { AiBrowser, mergeBrowserSelection } from '../ai-browser.js';
import { AiService } from '../ai.js';
import { loadConfig } from '../config.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gd-ai-browser-'));
const fixture = `<main><h1>Fixture product</h1>
<select optionTitle="Color"><option value="">Color</option><option value="red" price="20000">Red</option><option value="yellow" price="30000">Yellow</option></select>
<select optionTitle="Size" disabled><option value="">Size</option></select>
<input optiontype="ioOption" optionTitle="Engraving" price="5000" disabled value="private-value">
<div id="detailList"><img src="https://fixture.test/detail.jpg" title="Detail image"></div>
<button aria-label="상품상세 더보기" onclick="document.querySelector('#detailList').hidden=false">More</button>
<button id="buy" onclick="fetch('/cart/add',{method:'POST'})">Buy now</button>
<script>document.querySelector('select').onchange=async()=>{const r=await fetch('/view/option',{method:'POST',body:new URLSearchParams({mode:'checkoption1',optnum:'123',optvalue1:'red'})});const d=await r.json();const s=document.querySelectorAll('select')[1];s.innerHTML='<option value="">Size</option>'+d.html;s.disabled=false;};</script></main>`;
const product = { title: 'Fixture product', price: 1000, currency: 'KRW', optionGroups: [], optionAnalysis: { status: 'unresolved' }, images: ['https://fixture.test/main.jpg'], content: { blocks: [], status: 'unavailable' }, status: 'needs_review' };
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let lookups = 0, writes = 0;
  await page.route('**/*', route => {
    const u = new URL(route.request().url());
    if (u.pathname === '/view/option') { lookups++; return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ html: '<option value="M">Medium</option><option value="L">Large</option>' }) }); }
    if (u.pathname === '/cart/add' || route.request().method() === 'POST') writes++;
    return route.fulfill({ contentType: 'text/html', body: fixture });
  });
  await page.goto('https://fixture.test/product');
  let calls = 0;
  const config = { ...loadConfig({}), aiEnabled: true, apiKey: 'fixture-only', model: 'fixture-only', inputPrice: 1, outputPrice: 1, stateFile: path.join(dir, 'usage.json') };
  const mock = async (_, init) => {
    calls++;
    const body = JSON.parse(init.body);
    assert.equal(body.parallel_tool_calls, false); assert.equal(body.store, false);
    let name, args;
    if (calls === 1) {
      const observation = JSON.parse(body.input[0].content).page;
      assert(!JSON.stringify(observation).includes('private-value'));
      assert.equal(observation.controls[0].choices[0].priceDelta, 20000);
      assert.equal(observation.controls[1].disabled, true);
      assert.equal(observation.controls[2].priceDelta, 5000);
      assert(!observation.actions.some(a => /Buy now/.test(a.name)));
      name = 'browser_action'; args = { action: 'select', target: observation.controls[0].id, value: 'red' };
    } else {
      const output = JSON.parse(body.input.at(-1).output);
      assert.equal(output.result, 'done');
      assert.equal(output.page.controls[1].disabled, false);
      assert.equal(output.page.controls[1].choices.length, 2);
      assert(body.input.some(item => item.type === 'function_call'));
      assert(body.input.some(item => item.type === 'reasoning' && item.encrypted_content === 'fixture-encrypted'));
      name = 'finish_analysis'; args = { claims: [], optionIds: output.page.controls.map(c => c.id), detailIds: [output.page.images[0].id] };
    }
    return new Response(JSON.stringify({ status: 'completed', usage: { input_tokens: 100, output_tokens: 100 }, output: [{ type: 'reasoning', summary: [], encrypted_content: 'fixture-encrypted' }, { type: 'function_call', call_id: `call-${calls}`, name, arguments: JSON.stringify(args) }] }));
  };
  const ai = new AiService(config, { fetchImpl: mock });
  const session = new AiBrowser(page);
  const result = await ai.browse(product, session);
  assert.equal(calls, 2); assert.equal(lookups, 1); assert.equal(writes, 0);
  assert.equal(result.aiAnalysis.mode, 'browser'); assert.equal(result.aiAnalysis.status, 'success');
  assert.equal(result.aiAnalysis.steps, 2); assert(result.aiAnalysis.accepted >= 4);
  assert.equal(result.optionGroups.length, 3);
  assert.equal(result.optionGroups[0].values[0].priceDelta, 20000);
  assert.equal(result.optionGroups[1].values.length, 2);
  assert.equal(result.optionGroups[2].type, 'text'); assert.equal(result.optionGroups[2].priceDelta, 5000);
  assert.equal(result.content.blocks[0].url, 'https://fixture.test/detail.jpg');
  assert.equal(result.optionAnalysis.status, 'partial');
  const guarded = new AiBrowser(page); const observation = await guarded.read();
  assert.equal((await guarded.execute({ action: 'click', target: 'buy' })).result, 'unknown_target');
  await page.evaluate(async () => { await fetch('/cart/add', { method: 'POST' }).catch(() => {}); await fetch('/view/option', { method: 'POST', body: 'mode=delete&optnum=123' }).catch(() => {}); });
  assert.equal(writes, 0); assert.equal(lookups, 1);
  const invalid = mergeBrowserSelection(product, guarded, { optionIds: ['invented'], detailIds: ['invented'] });
  assert.equal(invalid.accepted, 0); assert.equal(invalid.rejected.length, 2);
  const before = lookups;
  await guarded.execute({ action: 'select', target: observation.controls[0].id, value: 'invented' });
  assert.equal(lookups, before);
  await guarded.close();
  const disabled = new AiService({ ...config, aiEnabled: false }, { fetchImpl: mock });
  assert.equal((await disabled.browse(product, new AiBrowser(page))).aiAnalysis.reason, 'disabled'); assert.equal(calls, 2);
  const limit = new AiService({ ...config, browserSteps: 1, stateFile: path.join(dir, 'limit.json') }, { fetchImpl: async (_, init) => {
    const body = JSON.parse(init.body); assert.equal(body.tool_choice.name, 'finish_analysis');
    return new Response(JSON.stringify({ status: 'completed', output: [{ type: 'function_call', name: 'finish_analysis', call_id: 'limit', arguments: JSON.stringify({ claims: [], optionIds: [], detailIds: [] }) }] }));
  } });
  assert.equal((await limit.browse(product, new AiBrowser(page))).aiAnalysis.steps, 1);
  // Shared group headings must not replace stage titles or merge different controls.
  const stagesPage = await browser.newPage();
  await stagesPage.setContent(`<div class="form-group"><label>옵션 선택</label>
    <select id="first"><option value="">공지 확인</option><option value="yes">동의합니다</option></select>
    <select id="second" name="stage"><option value="">세트구성</option><option value="set-a">구성 A</option></select>
    <select id="third" optionTitle="공지 확인 / 세트구성 / 색상"><option value="">색상</option><option value="white">화이트</option></select>
    <select id="same-a" aria-label="공통"><option value="a">선택 A</option></select>
    <select id="same-b" aria-label="공통"><option value="b">선택 B</option></select></div>`);
  const stages = new AiBrowser(stagesPage);
  const initial = await stages.read();
  assert.deepEqual(initial.controls.map(c => c.name), ['공지 확인', '세트구성', '색상', '공통', '공통']);
  const selection = { optionIds: initial.controls.map(c => c.id), detailIds: [] };
  const separated = mergeBrowserSelection(product, stages, selection);
  assert.equal(separated.product.optionGroups.length, 5);
  assert.deepEqual(separated.product.optionGroups.map(g => g.values.map(v => v.id)), [['yes'], ['set-a'], ['white'], ['a'], ['b']]);
  // Repeated AI references and subsequent observations must not duplicate the same control.
  const repeated = mergeBrowserSelection(separated.product, stages, { optionIds: [...selection.optionIds, selection.optionIds[0]], detailIds: [] });
  assert.equal(repeated.product.optionGroups.length, 5);
  const priorDom = { ...product, optionGroups: [{ id: 'dom-second', name: '옵션 선택', sourceId: 'second', sourceName: '', type: 'select', values: [] }] };
  const supplemented = mergeBrowserSelection(priorDom, stages, selection);
  assert.equal(supplemented.product.optionGroups.length, 5);
  assert.equal(supplemented.product.optionGroups.find(g => g.id === 'dom-second').values[0].id, 'set-a');
  const otherElement = { ...product, optionGroups: [{ id: 'other', name: '세트구성', sourceId: 'other-element', sourceName: 'stage', type: 'select', values: [] }] };
  assert.equal(mergeBrowserSelection(otherElement, stages, selection).product.optionGroups.length, 6);
  await stages.close(); await stagesPage.close();
  console.log('PASS: AI-driven Chromium select -> read-only POST -> dependent options -> finish, text input/price/detail extraction, diagnostics, mutation blocking, invalid refs, disabled AI, step cap');
} finally {
  await browser.close();
  for (const file of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, file)); fs.rmdirSync(dir);
}
