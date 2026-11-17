import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { collectProductEvidence, validateProductData } from '../product-availability.js';

const valid = { title: 'Fixture product', price: 1000, images: ['https://fixture.test/product.jpg'], optionGroups: [], optionAnalysis: { status: 'none' }, status: 'complete' };
assert.equal(validateProductData(valid, { identified: true }).status, 'complete');
for (const patch of [{ images: [] }, { price: null }, { title: '' }, { optionAnalysis: { status: 'unresolved' } }]) {
  assert.equal(validateProductData({ ...valid, ...patch }, { identified: true }).status, 'needs_review');
}
assert.throws(() => validateProductData({}, { identified: true }), { code: 'product_data_missing' });
assert.throws(() => validateProductData(valid), { code: 'product_data_missing' });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  // A generic product layout with article metadata must not require known CSS roots.
  await page.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html', body: '' }));
  await page.goto('https://fixture.test/view?id=123');
  const generic = '<meta property="og:type" content="article"><meta property="og:url" content="https://fixture.test/view?id=123"><meta property="og:title" content="Fixture product"><meta property="og:image" content="https://fixture.test/product.jpg"><h1>Fixture product</h1>';
  await page.setContent(generic);
  const genericInput = { sourceUrl: 'https://fixture.test/view?id=123', collectedProduct: valid };
  assert.equal((await page.evaluate(collectProductEvidence, genericInput)).identified, true);
  assert.equal(validateProductData(valid, await page.evaluate(collectProductEvidence, genericInput)).status, 'complete');
  assert.equal((await page.evaluate(collectProductEvidence, { ...genericInput, sourceUrl: 'https://fixture.test/view?id=999' })).identified, false);
  await page.goto('https://fixture.test/');
  await page.setContent(generic);
  assert.equal((await page.evaluate(collectProductEvidence, genericInput)).identified, false);
  await page.setContent(generic.replace('<h1>Fixture product</h1>', '<h1>Store home</h1>'));
  assert.equal((await page.evaluate(collectProductEvidence, genericInput)).identified, false);
  await page.unroute('https://fixture.test/**');
  for (const [html, identified] of [
    ['<title>Store home</title><meta property="og:image" content="/logo.jpg"><h1>Store</h1><div class="recommend"><p>Recommended product 19,000원</p><img src="/recommend.jpg"></div>', false],
    ['<div id="productDetail"><p>Product missing</p><div class="recommend"><img src="/recommend.jpg"></div></div>', false],
    ['<div class="product-info"><h1 class="product-name">Real product</h1></div>', true],
    ['<h1>Real product</h1><div class="product-gallery"><img src="/product.jpg"></div>', true],
    ['<meta property="product:price:amount" content="1000">', true],
  ]) {
    await page.setContent(html);
    const evidence = await page.evaluate(collectProductEvidence, {});
    assert.equal(evidence.identified, identified, html);
    if (identified) validateProductData(valid, evidence);
    else assert.throws(() => validateProductData(valid, evidence), { code: 'product_data_missing' });
  }
  // Alerts do not decide success: valid data survives even a product-not-found alert.
  await page.setContent('<div class="product-info"><span class="product-name">Real product</span></div>');
  await page.evaluate(() => alert('존재하지 않는 상품입니다.'));
  validateProductData(valid, await page.evaluate(collectProductEvidence, {}));
  // A redirect without any alert still fails when only store data remains.
  await page.route('https://fixture.test/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body:
    route.request().url().includes('/item') ? '<script>location.replace("/")</script>' : '<title>Store home</title><p>Recommended product 19,000원</p>' }));
  await page.goto('https://fixture.test/item');
  await page.waitForURL('https://fixture.test/');
  assert.throws(() => validateProductData(valid, { identified: false }), { code: 'product_data_missing' });
  assert.equal((await page.evaluate(collectProductEvidence, {})).identified, false);
  await page.close();
  console.log('product data validation tests passed');
} finally { await browser.close(); }
