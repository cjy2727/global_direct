import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright';
import { normalizeShoppingProduct } from '../global-shopping.js';
import { applyOptionFallback } from '../option-fallback.js';
import { makeshopFixture } from './fixtures/makeshop-product.js';

const template = process.env.REQUEST_AI_TEMPLATE;
assert.ok(template && fs.existsSync(template), 'Mount the approved request_ai.ctp as REQUEST_AI_TEMPLATE');
const lint = spawnSync('php', ['-l', template], { encoding: 'utf8' });
assert.equal(lint.status, 0, lint.stdout + lint.stderr);
const url = 'https://shop.example.test/shop/shopdetail.html?branduid=123';
const render = (product, loggedIn = false) => {
  const data = Buffer.from(JSON.stringify(product)).toString('base64');
  const php = `define('ORDERS_SSL_PATH','https://orders.example.test');$_SESSION=array('Auth'=>array('Member'=>array('user_id'=>'${loggedIn ? 'fixture-user' : ''}')));$product=json_decode(base64_decode("${data}"),true);$submittedUrl="";eval("?>".file_get_contents(getenv("REQUEST_AI_TEMPLATE")));`;
  const result = spawnSync('php', ['-r', php], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '', result.stderr);
  return result.stdout;
};
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', route => route.abort());
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const fixture = makeshopFixture();
  const product = applyOptionFallback(normalizeShoppingProduct(fixture, url, url));
  const selection = () => page.evaluate(() => window.requestAiSelection);
  await page.setContent(render(product));
  assert.deepEqual(await selection(), { options: [], option: '', qty: 1, additionalProducts: [] });
  await page.evaluate(() => { window.fixtureSelectionReference = window.requestAiSelection; });
  const color = page.locator('#product-options [data-option-id="option-44"]');
  const size = page.locator('#product-options [data-option-id="option-31"]');
  const set = page.locator('#product-options [data-option-id="option-29"]');
  assert.equal(await page.locator('#product-options select').count(), 3);
  assert.equal(await size.isDisabled(), true);
  await color.selectOption('0');
  assert.equal(await size.isDisabled(), false);
  await size.selectOption('0');
  await set.selectOption('1');
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 73,900');
  assert.deepEqual((await selection()).options, [
    { id: 'option-44', name: 'Color', valueId: '0', value: 'Red' },
    { id: 'option-31', name: 'Size', valueId: '0', value: 'Small' },
    { id: 'option-29', name: 'Set', valueId: '1', value: 'Pillow set' },
  ]);
  assert.equal((await selection()).option, 'Color: Red / Size: Small / Set: Pillow set');
  assert.equal(await page.evaluate(() => window.fixtureSelectionReference === window.requestAiSelection), true);
  await size.selectOption('1');
  assert.equal(await set.locator('option[value="0"]').evaluate(option => option.disabled), true,
    JSON.stringify({ controls: await page.locator('#product-options select').evaluateAll(items => items.map(item => ({ id: item.dataset.optionId, value: item.value }))), errors }));
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 83,900');
  await page.evaluate(() => {
    const control = document.querySelector('[data-option-id="option-29"]');
    control.value = '0'; control.dispatchEvent(new Event('change', { bubbles: true }));
  });
  assert.equal(await set.inputValue(), ''); // Reject a programmatic hidden combination too.
  assert.equal((await selection()).option, 'Color: Red / Size: Large');
  await color.selectOption('');
  assert.equal(await size.inputValue(), '');
  assert.equal(await set.inputValue(), '');
  assert.deepEqual((await selection()).options, []);
  assert.equal((await selection()).option, '');
  await color.selectOption('0');
  await size.selectOption('0'); await set.selectOption('1');
  assert.equal(await page.locator('[data-additional-product]').count(), 6);
  assert.equal(await page.locator('.additional-option-title').first().textContent(), 'Extra 1');
  assert.equal(await page.locator('[data-additional-product] input[type="checkbox"]').count(), 0);
  assert.equal(await page.locator('[data-additional-product] img').count(), 0);
  const extra = page.locator('[data-additional-product]').first();
  const extraSelect = extra.locator('select');
  assert.equal(await extraSelect.isDisabled(), false);
  assert.equal(await extra.locator('[data-additional-quantity]').isDisabled(), true);
  assert.equal(await extraSelect.locator('option[value="1"]').evaluate(option => option.disabled), true);
  await extraSelect.selectOption('0');
  assert.equal(await extra.locator('[data-additional-quantity]').isDisabled(), false);
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 108,800');
  assert.deepEqual((await selection()).additionalProducts, [{ uid: '123-46', title: 'Extra 1',
    options: [{ id: 'option-46', name: 'Extra 1', valueId: '0', value: 'White' }], option: 'Extra 1: White', qty: 1 }]);
  await extra.locator('[data-additional-quantity]').fill('2');
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 143,700');
  assert.equal((await selection()).additionalProducts[0].qty, 2);
  await extraSelect.selectOption('');
  assert.equal(await extra.locator('[data-additional-quantity]').isDisabled(), true);
  assert.deepEqual((await selection()).additionalProducts, []);
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 73,900');
  await page.locator('#product-options [name="quantity"]').fill('2');
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 147,800');
  assert.equal((await selection()).qty, 2);
  await page.locator('#product-options [name="quantity"]').fill('0');
  assert.equal((await selection()).qty, null);
  const partialExtra = makeshopFixture(); partialExtra.products[1].options.addition.pop();
  await page.setContent(render(applyOptionFallback(normalizeShoppingProduct(partialExtra, url, url))));
  await color.selectOption('0'); await size.selectOption('0'); await set.selectOption('1');
  const partialField = page.locator('[data-additional-product]').first();
  assert.equal(await partialField.locator('select option[value="1"]').count(), 0);
  await partialField.locator('select').selectOption('0');
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 108,800');
  await partialField.locator('select').selectOption('__manual__');
  assert.equal(await partialField.locator('[data-additional-manual-for]').isEnabled(), true);
  await partialField.locator('[data-additional-manual-for]').fill('Unconfirmed fixture choice');
  assert.deepEqual((await selection()).additionalProducts[0].options,
    [{ id: 'option-46', name: 'Extra 1', valueId: null, value: 'Unconfirmed fixture choice' }]);
  assert.ok((await page.locator('#option-selection-status').textContent()).includes('추가금'));
  assert.equal(await page.locator('#product-price').textContent(), '선택 금액 확인 필요');
  await partialField.locator('select').selectOption('0');
  assert.equal((await selection()).additionalProducts[0].option, 'Extra 1: White');
  await partialField.locator('select').selectOption('');
  assert.deepEqual((await selection()).additionalProducts, []);
  const plainFixture = makeshopFixture();
  plainFixture.products.push({ uid: 'plain', product_name: 'Independent extra', opt_type: 'add', required: 'N', sellprice: 12000,
    sell_accept: 'Y', options: { option: [], basic: [] } });
  await page.setContent(render(applyOptionFallback(normalizeShoppingProduct(plainFixture, url, url))));
  await color.selectOption('0'); await size.selectOption('0'); await set.selectOption('1');
  const plain = page.locator('[data-additional-uid="plain"]');
  await plain.locator('[data-additional-purchase]').selectOption('selected');
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 85,900');
  assert.deepEqual((await selection()).additionalProducts, [{ uid: 'plain', title: 'Independent extra', options: [], option: '', qty: 1 }]);
  await plain.locator('[data-additional-purchase]').selectOption('');
  assert.deepEqual((await selection()).additionalProducts, []);
  assert.equal(await page.locator('#product-price').textContent(), 'KRW 73,900');
  plainFixture.products.at(-1).required = 'Y';
  await page.setContent(render(applyOptionFallback(normalizeShoppingProduct(plainFixture, url, url))));
  assert.equal(await plain.locator('[data-additional-purchase]').inputValue(), 'selected');
  assert.equal(await plain.locator('option[value=""]').evaluate(option => option.disabled), true);
  assert.equal((await selection()).additionalProducts[0].uid, 'plain');
  const incomplete = makeshopFixture(); incomplete.products[0].options.basic.pop();
  await page.setContent(render(applyOptionFallback(normalizeShoppingProduct(incomplete, url, url))));
  assert.equal(await page.locator('#product-options select').count(), 0);
  assert.equal(await page.locator('#product-options input[data-option-id]').count(), 3);
  const manualMain = page.locator('#product-options input[data-option-id]').first();
  await manualMain.fill('  Blue <special>  ');
  assert.equal((await selection()).options[0].value, 'Blue <special>');
  assert.equal((await selection()).options[0].valueId, null);
  assert.ok((await selection()).option.includes(': Blue <special>'));
  await manualMain.fill('');
  assert.deepEqual((await selection()).options, []);
  const unknownPrice = structuredClone(product);
  unknownPrice.additionalProducts[0].price = null;
  await page.setContent(render(unknownPrice));
  await extraSelect.selectOption('0');
  assert.equal((await selection()).additionalProducts[0].option, 'Extra 1: White');
  const noOptions = { ...product, optionGroups: [], optionFallback: { fields: [] }, additionalProducts: [] };
  await page.setContent(render(noOptions));
  await page.locator('[name="manual_option"]').fill('Custom request');
  assert.deepEqual((await selection()).options, [{ id: 'manual_option', name: '옵션', valueId: null, value: 'Custom request' }]);
  await page.setContent(render({}));
  assert.deepEqual(await selection(), { options: [], option: '', qty: null, additionalProducts: [] });

  // Intercept every request: these assertions never write to a real cart.
  const cartPage = await browser.newPage();
  cartPage.on('pageerror', error => errors.push(error.message));
  const cartRequests = [];
  let replies = [];
  let holdResponse = false;
  let releaseResponse;
  await cartPage.route('**/*', async route => {
    const request = route.request();
    if (new URL(request.url()).pathname === '/orders/ajax_dh_cart') {
      cartRequests.push({ data: Object.fromEntries(new URLSearchParams(request.postData())), headers: request.headers(), method: request.method() });
      if (holdResponse) await new Promise(resolve => { releaseResponse = resolve; });
      const reply = replies.shift() ?? { result: true, login: true, cart_id: 'fixture-cart' };
      if (reply === 'network') return route.abort('failed');
      if (reply === 'invalid') return route.fulfill({ status: 200, contentType: 'text/html', body: '<html>Unexpected response</html>' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
    }
    if (request.isNavigationRequest()) return route.fulfill({ status: 200, contentType: 'text/html', body: '<html></html>' });
    await route.abort();
  });
  await cartPage.goto('https://orders.example.test/fixture');
  const loadCart = async (value = product, loggedIn = true) => {
    cartRequests.length = 0; replies = []; holdResponse = false;
    await cartPage.setContent(render(value, loggedIn));
    await cartPage.evaluate(() => {
      window.cartConfirmation = null;
      window.newConfirm = (message, action) => { window.cartConfirmation = { message, action }; };
    });
  };
  const chooseMain = async () => {
    await cartPage.locator('[data-option-id="option-44"]').selectOption('0');
    await cartPage.locator('[data-option-id="option-31"]').selectOption('0');
    await cartPage.locator('[data-option-id="option-29"]').selectOption('1');
  };
  const cartButton = cartPage.locator('[data-add-to-cart]');
  const cartStatus = cartPage.locator('#cart-status');
  const agree = () => cartPage.locator('[name="purchase_agreement"]').check();
  const finishCart = async () => {
    await cartButton.click();
    await cartPage.waitForFunction(() => document.querySelector('[data-add-to-cart]').textContent !== '담는 중…');
  };
  await loadCart();
  await finishCart(); // Required options are missing.
  assert.equal(cartRequests.length, 0);
  await chooseMain(); await finishCart(); // Agreement is required.
  assert.equal(cartRequests.length, 0);
  assert.match(await cartStatus.textContent(), /동의/);
  await agree();
  await cartPage.locator('[name="quantity"]').fill('0'); await finishCart();
  assert.equal(cartRequests.length, 0);
  await cartPage.locator('[name="quantity"]').fill('2');
  const cartExtra = cartPage.locator('[data-additional-product]').first();
  await cartExtra.locator('select').selectOption('0');
  await cartExtra.locator('[data-additional-quantity]').fill('3');
  await cartPage.locator('[name="request_note"]').fill('Wrap | safely ^ please');
  holdResponse = true;
  await cartButton.click();
  while (!releaseResponse) await new Promise(resolve => setTimeout(resolve, 10));
  await cartPage.evaluate(() => document.querySelector('[data-add-to-cart]').dispatchEvent(new Event('click')));
  assert.equal(cartRequests.length, 1, 'Duplicate click must not start a second request');
  assert.equal(await cartPage.locator('[name="quantity"]').isDisabled(), true);
  holdResponse = false; releaseResponse(); releaseResponse = null;
  await cartPage.waitForFunction(() => document.querySelector('[data-add-to-cart]').textContent === '장바구니');
  assert.equal(cartRequests.length, 2);
  const [mainCart, extraCart] = cartRequests.map(item => item.data);
  assert.equal(mainCart.price, '73900'); assert.equal(mainCart.qty, '2');
  assert.equal(extraCart.price, '34900'); assert.equal(extraCart.qty, '3');
  assert.equal(mainCart.country, 'KR'); assert.equal(mainCart.url, url);
  assert.equal(mainCart.shop, 'shop.example.test'); assert.equal(mainCart.name, product.title);
  assert.equal(mainCart.option, 'color|Color: Red / Size: Small / Set: Pillow set^size|요청사항: Wrap ｜ safely ＾ please');
  assert.ok(extraCart.option.includes('기본상품: ' + product.title));
  assert.ok(extraCart.option.includes('Extra 1: White')); assert.notEqual(mainCart.code, extraCart.code);
  assert.equal(cartRequests[0].headers['x-requested-with'], 'XMLHttpRequest');
  assert.equal(cartRequests[0].method, 'POST');
  assert.equal('user_id' in mainCart, false, 'Use the existing server session');
  assert.equal(await cartPage.locator('[name="quantity"]').isDisabled(), false);
  assert.equal(await cartPage.locator('#cart-result-link').getAttribute('href'), 'https://orders.example.test/orders/purchase_proxy/KR');
  assert.ok(await cartPage.evaluate(() => window.cartConfirmation.message.includes('장바구니')));
  await Promise.all([cartPage.waitForURL('**/orders/purchase_proxy/KR'), cartPage.evaluate(() => window.cartConfirmation.action())]);

  await loadCart(applyOptionFallback(normalizeShoppingProduct(partialExtra, url, url)));
  await chooseMain(); await agree();
  await cartExtra.locator('select').selectOption('__manual__');
  await cartExtra.locator('[data-additional-manual-for]').fill('Custom extra');
  await finishCart(); assert.equal(cartRequests.length, 0, 'Validate all rows before saving the main product');
  await cartExtra.locator('[data-cart-unit-price]').fill('0');
  await finishCart(); assert.equal(cartRequests.length, 0);
  await cartExtra.locator('[data-cart-unit-price]').fill('45000');
  await cartExtra.locator('[data-additional-manual-for]').fill('Changed extra');
  assert.equal(await cartExtra.locator('[data-cart-unit-price]').inputValue(), '', 'Changing an option invalidates its confirmed price');
  await cartExtra.locator('[data-cart-unit-price]').fill('45000');
  await finishCart();
  assert.equal(cartRequests[1].data.price, '45000');
  assert.ok(cartRequests[1].data.option.includes('Changed extra'));
  assert.ok(!cartRequests[1].data.option.includes('__manual__'));

  await loadCart(applyOptionFallback(normalizeShoppingProduct(incomplete, url, url)));
  for (const control of await cartPage.locator('#product-options [data-option-id]').all()) await control.fill('Custom selection');
  await agree(); await finishCart(); assert.equal(cartRequests.length, 0);
  await cartPage.locator('#product-options [data-cart-unit-price]').fill('90000');
  await finishCart(); assert.equal(cartRequests[0].data.price, '90000');
  assert.ok(cartRequests[0].data.option.includes('Custom selection'));

  for (const failure of ['network', 'invalid', { result: false, login: true, err_msg: '<img src=x onerror=alert(1)> Fixture rejection' }]) {
    await loadCart(); await chooseMain(); await agree(); replies = [failure];
    await finishCart();
    assert.equal(cartRequests.length, 1);
    assert.equal(await cartButton.isDisabled(), typeof failure === 'string');
    assert.equal(await cartStatus.locator('img').count(), 0, 'Server errors are displayed as text');
    if (typeof failure === 'object') {
      await finishCart(); assert.equal(cartRequests.length, 2, 'Explicit rejection allows retry');
    }
  }
  await loadCart(); await chooseMain(); await agree();
  await cartExtra.locator('select').selectOption('0');
  replies = [{ result: true }, { result: false, err_msg: 'Fixture extra rejected' }];
  await finishCart();
  assert.equal(cartRequests.length, 2); assert.equal(await cartButton.isDisabled(), true);
  assert.match(await cartStatus.textContent(), /1개 항목이 저장/);
  assert.equal(await cartPage.locator('#cart-result-link').isVisible(), true);
  await cartPage.evaluate(() => document.querySelector('[data-add-to-cart]').dispatchEvent(new Event('click')));
  assert.equal(cartRequests.length, 2, 'Partial success must not resubmit saved rows');

  for (const changed of [{ availability: 'OutOfStock' }, { currency: 'UNKNOWN' }, { title: '' }]) {
    await loadCart({ ...product, ...changed }); await chooseMain(); await agree();
    await finishCart(); assert.equal(cartRequests.length, 0);
  }
  await loadCart(); await chooseMain(); await agree();
  replies = [{ result: false, login: false, err_msg: 'Session expired' }];
  await Promise.all([cartPage.waitForURL('**/members/login'), cartButton.click()]);
  assert.equal(cartRequests.length, 1);
  await cartPage.goto('https://orders.example.test/fixture');
  await loadCart(product, false);
  await Promise.all([cartPage.waitForURL('**/members/login'), cartButton.click()]);
  assert.equal(cartRequests.length, 0);
  if (process.env.UI_PREVIEW_DIR) {
    fs.mkdirSync(process.env.UI_PREVIEW_DIR, { recursive: true });
    await loadCart(applyOptionFallback(normalizeShoppingProduct(partialExtra, url, url)));
    await chooseMain(); await agree();
    await cartExtra.locator('select').selectOption('__manual__');
    await cartExtra.locator('[data-additional-manual-for]').fill('Custom extra');
    await cartExtra.locator('[data-cart-unit-price]').fill('45000');
    for (const width of [1280, 390]) {
      await cartPage.setViewportSize({ width, height: 1000 });
      assert.equal(await cartPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const fieldBox = await cartExtra.locator('[data-cart-unit-price]').boundingBox();
      const rowBox = await cartExtra.boundingBox();
      assert.ok(fieldBox.x >= rowBox.x && fieldBox.x + fieldBox.width <= rowBox.x + rowBox.width);
      await cartPage.locator('.product-info').screenshot({ path: path.join(process.env.UI_PREVIEW_DIR, `cart-manual-${width}.png`) });
    }
  }
  await cartPage.close();
  console.log('Cart mock/browser: payloads, unit prices, quantities, manual input, validation, duplicate click, partial success, network errors and login passed');
  if (process.env.UI_PREVIEW_DIR) {
    fs.mkdirSync(process.env.UI_PREVIEW_DIR, { recursive: true });
    const preview = makeshopFixture(); preview.products[4].options.addition.pop();
    const names = ['매트리스커버', '방수매트리스커버', '침대패드', '베개커버', '베개솜', '세탁망 / 이불가방'];
    preview.products.slice(1).forEach((product, index) => { product.options.option[0].opt_name = names[index]; });
    const rendered = render(applyOptionFallback(normalizeShoppingProduct(preview, url, url)));
    await page.setViewportSize({ width: 1280, height: 1000 });
    await page.setContent(rendered);
    await page.locator('[data-additional-product]').first().locator('select').selectOption('0');
    const region = page.locator('.additional-products');
    const desktopWidth = (await region.boundingBox()).width;
    assert.ok(await region.locator('[data-additional-product]').first().evaluate(node => node.getBoundingClientRect().height) < 120);
    await region.screenshot({ path: path.join(process.env.UI_PREVIEW_DIR, 'additional-options-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.ok((await region.boundingBox()).width < desktopWidth);
    const mobileRow = region.locator('[data-additional-product]').first();
    const selectBox = await mobileRow.locator('select').boundingBox();
    const quantityBox = await mobileRow.locator('[data-additional-quantity]').boundingBox();
    assert.ok(quantityBox.y >= selectBox.y + selectBox.height);
    await region.screenshot({ path: path.join(process.env.UI_PREVIEW_DIR, 'additional-options-mobile.png') });
  }
  assert.deepEqual(errors, []);
  console.log('Rendered PHP/browser: choices, prices, selection state, dependent resets, additional products, quantities and manual fallback passed');
} finally { await browser.close(); }
