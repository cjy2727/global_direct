import assert from 'node:assert/strict';
import { chromium } from 'playwright';
let input = '';
for await (const chunk of process.stdin) input += chunk;
const { productHtml, requestHtml } = JSON.parse(input);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  let cartBody;
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/assets/')) {
      const response = await fetch(url.href);
      return route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) });
    }
    if (url.pathname === '/api/cart/items') {
      cartBody = route.request().postDataJSON();
      return route.fulfill({ json: { ok: true, cart: { count: 3 } } });
    }
    if (url.pathname === '/api/cart') return route.fulfill({ json: { items: [{ ...cartBody, public_id: '0123456789abcdef', title: 'Fixture' }] } });
    const html = url.pathname === '/request' ? requestHtml : url.pathname === '/cart'
      ? '<div id="cart-list"></div><script src="/assets/app.js"></script>' : productHtml;
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://nginx/products/fixture');
    assert.equal(await page.locator('[data-option-id="consent"]').inputValue(), '');
    await page.locator('#add-cart-button').click();
    assert.equal(await page.locator('#product-action-form').evaluate((form) => form.checkValidity()), false);
    await page.locator('[data-option-id="email"]').fill('fixture@example.test');
    await page.locator('[data-option-id="consent"]').selectOption('yes');
    await page.locator('[name="quantity"]').fill('3');
    await page.locator('#add-cart-button').click();
    await page.waitForFunction(() => document.querySelector('#product-action-message').classList.contains('success'), null, { timeout: 5000 }).catch(() => {
      throw new Error(`Cart response missing: ${JSON.stringify({ errors, cartBody })}`);
    });
    assert.deepEqual(cartBody.selected_options, { email: 'fixture@example.test', consent: 'yes' });
    await page.locator('#buy-now-button').click();
    await page.waitForURL('**/request?*');
    assert.equal(await page.locator('[data-option-id="email"]').inputValue(), 'fixture@example.test');
    assert.equal(await page.locator('[data-option-id="consent"]').inputValue(), 'yes');
    await page.evaluate(() => sessionStorage.clear());
    await page.goto('http://nginx/cart');
    await page.locator('[data-cart-index]').click();
    await page.waitForURL('**/request?*');
    assert.equal(await page.locator('[name="quantity"]').inputValue(), '3');
    assert.equal(await page.locator('[data-option-id="consent"]').inputValue(), 'yes');
    assert.equal(await page.locator('[data-option-id="email"]').inputValue(), 'fixture@example.test');
  }
  assert.deepEqual(errors, []);
  console.log('Options desktop/mobile flow: OK (mock API, no real orders)');
} finally {
  await browser.close();
}
