import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { watchNaverAccess } from '../analyzer.js';
import { watchOptionResponses } from '../option-collector.js';

class Page extends EventEmitter {
  constructor(url) { super(); this.currentUrl = url; }
  url() { return this.currentUrl; }
  mainFrame() { return 'main'; }
}
const product = 'https://smartstore.naver.com/choicemallplus/products/13774570720';
const detail = 'https://m.smartstore.naver.com/i/v2/channels/example/products/13774570720';
const response = (url, status = 429, type = 'xhr', frame = 'main') => ({ url: () => url, status: () => status, request: () => ({ resourceType: () => type, isNavigationRequest: () => type === 'document', frame: () => frame }) });
const denied = error => error.code === 'store_access_denied' && error.status === 422;
const loginRequired = error => error.code === 'store_login_required' && error.status === 422;
const verificationRequired = error => error.code === 'store_verification_required' && error.status === 422;

{
  const page = new Page(product);
  const watch = watchNaverAccess(page, product);
  page.currentUrl = 'https://nid.naver.com/nidlogin.login';
  assert.throws(() => watch.check(), loginRequired);
  watch.dispose();
  assert.equal(page.listenerCount('response'), 0);
}
{
  const page = new Page(product);
  const watch = watchNaverAccess(page, product);
  page.emit('response', response(detail, 200));
  page.emit('response', response(detail.replace('13774570720', '999'), 429));
  page.emit('response', response('https://other.example/i/v2/channels/example/products/13774570720'));
  page.emit('response', response(detail, 429, 'image'));
  assert.doesNotThrow(() => watch.check());
  page.emit('response', response(detail));
  assert.throws(() => watch.check(), denied);
  watch.dispose();
}
{
  const url = 'https://example.com/products/13774570720';
  const page = new Page(url);
  const watch = watchNaverAccess(page, url);
  page.currentUrl = 'https://nid.naver.com/nidlogin.login';
  page.emit('response', response(detail));
  assert.doesNotThrow(() => watch.check());
  watch.dispose();
}
for (const status of [403, 429, 490]) {
  for (const [url, type] of [[product, 'document'], [detail, 'xhr'], [detail, 'fetch']]) {
    const page = new Page(product);
    const watch = watchNaverAccess(page, product);
    page.emit('response', response(url, status, type));
    assert.throws(() => watch.check(), status === 490 ? verificationRequired : denied);
    watch.dispose();
    assert.equal(page.listenerCount('response'), 0);
  }
}
{
  const page = new Page(product);
  const watch = watchNaverAccess(page, product);
  page.emit('response', response(product, 490, 'document', 'child'));
  page.emit('response', response(product.replace('13774570720', '999'), 490, 'document'));
  page.emit('response', response(product, 200, 'document'));
  page.emit('response', response(detail, 490, 'image'));
  assert.doesNotThrow(() => watch.check());
  page.emit('response', response(product, 490, 'document'));
  page.emit('response', response(detail, 429));
  assert.throws(() => watch.check(), verificationRequired);
  watch.dispose();
}
{
  const page = new Page(product);
  const channel = 'https://m.smartstore.naver.com/i/v2/channels/example/products/13774570720';
  const captured = watchOptionResponses(page, product);
  page.emit('response', {
    url: () => channel, headers: () => ({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify({ id: 13774570720, name: 'Fixture', salePrice: 119000 }),
  });
  await captured.wait();
  assert.equal(captured.payloads.length, 1);
  await captured.finish();
}
console.log('PASS: Naver login, detail response capture, document/detail 403/429/490, unrelated responses and cleanup');
