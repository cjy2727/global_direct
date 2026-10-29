import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractProductOptions, mergeOptionGroups } from '../product-options.js';
import { normalizeOptionData, combineStructuredOptions } from '../option-sources.js';
import { collectOptions, exploreSelectOptions, waitForOptions, watchOptionResponses } from '../option-collector.js';

const identity = { url: 'https://fixture.test/products/shirt', title: 'Fixture shirt', currency: 'USD', price: 10 };
const shopify = { handle: 'shirt', title: 'Fixture shirt', options: ['Color', 'Size'], variants: [
  { options: ['Black', 'S'], price: 1000, available: true },
  { options: ['Black', 'M'], price: 1200, available: false },
  { options: ['White', 'L'], price: 1300, available: true },
] };
const structured = normalizeOptionData([{ recommendations: [shopify] }, shopify], identity);
assert.equal(structured.length, 1);
assert.equal(structured[0].groups[0].combinations[2].priceDelta, 3);
assert.equal(structured[0].groups[1].values.find((item) => item.id === 'M').disabled, true);
assert.equal(normalizeOptionData([{ ...shopify, title: 'Unrelated', handle: 'other' }], identity).length, 0);
assert.equal(normalizeOptionData([{ ...shopify, variants: [{ options: ['Black'], price: 1000 }] }], identity).length, 0);
assert.equal(normalizeOptionData([{ ...shopify, options: ['Title'], variants: [{ options: ['Default Title'], price: 1000 }] }], identity)[0].noOptions, true);
assert.equal(normalizeOptionData([{ ...shopify, variants: [{ options: ['Black', 'S'], price: 100000 }] }], { ...identity, currency: 'JPY', price: 1000 })[0].groups[0].combinations[0].priceDelta, 0);
const woo = normalizeOptionData([{ url: identity.url, variations: [
  { attributes: { attribute_color: 'red', attribute_size: 'm' }, display_price: 12, is_in_stock: true },
  { attributes: { attribute_color: 'blue', attribute_size: 's' }, display_price: 10, is_in_stock: false },
] }], identity)[0];
assert.equal(woo.groups[0].combinations[0].priceDelta, 2);
assert.equal(woo.groups[0].combinations[1].disabled, true);
assert.equal(normalizeOptionData([{ url: identity.url, optionGroups: [{ name: 'Finish', values: ['Matte', 'Gloss'] }] }], identity)[0].groups[0].values.length, 2);
const schema = normalizeOptionData([{ url: identity.url, '@type': 'ProductGroup', hasVariant: [
  { color: 'Red', size: 'S', offers: { price: 15, priceCurrency: 'USD', availability: 'https://schema.org/InStock' } },
] }], identity)[0];
assert.equal(schema.groups[0].combinations[0].priceDelta, 5);
assert.equal(schema.groups[0].combinationsComplete, false);

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('https://fixture.test/**', (route) => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto(identity.url);
  await page.setContent(`<nav><select name="language"><option value="en">English</option></select></nav>
    <section class="product-options">
    <label>Color<select id="color"><option value="">Select</option><option value="black">Black</option></select></label>
    <fieldset><legend>Size</legend><label><input type="radio" name="size" value="s">S</label><label><input type="radio" name="size" value="m" disabled>M</label></fieldset>
    <div role="radiogroup" aria-label="Material"><button role="radio" data-value="cotton">Cotton</button><button role="radio" data-value="silk" aria-disabled="true">Silk</button></div>
    <input name="optionlist[]" opt_id="email" label="Email" type="email" value="DO_NOT_COLLECT" require="Y">
    <div class="recommendations"><select name="size"><option value="x">Unrelated</option></select></div></section>`);
  const mixed = await page.evaluate(extractProductOptions, {});
  assert.equal(mixed.length, 4);
  assert.equal(mixed.find((group) => group.id === 'option-color').name, 'Color');
  assert.equal(mixed.find((group) => group.name === 'Size').values[1].disabled, true);
  assert.equal(mixed.find((group) => group.name === 'Material').values[1].disabled, true);
  assert.ok(!JSON.stringify(mixed).includes('DO_NOT_COLLECT'));
  assert.equal(mergeOptionGroups(mixed, mixed).length, 4);
  assert.equal(combineStructuredOptions(mixed, structured[0]).length, 4);

  await page.setContent('<div class="product-options" id="delayed"></div>');
  await page.evaluate(() => setTimeout(() => {
    document.querySelector('#delayed').innerHTML = '<select name="size"><option value="m">M</option></select>';
  }, 1700));
  assert.equal((await waitForOptions(page)).length, 1);

  await page.setContent(`<div class="product-options">
    <label>Color<select id="color"><option value="">Select</option><option value="black" data-price-delta="0">Black</option><option value="white" data-price-delta="0">White</option></select></label>
    <label>Size<select id="size" disabled><option value="">Select</option></select></label></div>`);
  await page.evaluate(() => {
    document.querySelector('#color').addEventListener('change', (event) => {
      const size = document.querySelector('#size');
      size.disabled = true;
      size.innerHTML = '<option value="">Select</option>';
      setTimeout(() => {
        size.innerHTML += (event.target.value === 'black' ? ['S', 'M'] : ['L']).map((value) => `<option value="${value}" data-price-delta="0">${value}</option>`).join('');
        size.disabled = false;
      }, 200);
      fetch('/cart/add', { method: 'POST', body: 'fixture' }).catch(() => {});
    });
  });
  let mutationEscaped = false;
  await page.route('**/cart/add', (route) => { mutationEscaped = true; return route.fulfill({ body: '{}' }); });
  const explored = await exploreSelectOptions(page, await page.evaluate(extractProductOptions, {}), { budget: 12000 });
  assert.equal(mutationEscaped, false);
  assert.equal(explored.complete, true);
  assert.equal(explored.groups[0].combinations.length, 3);
  assert.ok(!explored.groups[0].combinations.some((row) => row.values['option-color'] === 'black' && row.values['option-size'] === 'L'));
  const limited = await exploreSelectOptions(page, await page.evaluate(extractProductOptions, {}), { limit: 1 });
  assert.equal(limited.complete, false);

  // Shared names must resolve by opt_id and retain only valid dependent combinations.
  await page.setContent(`<form name="form1">
    <select name="optionlist[]" opt_id="2" opt_mix="Y" label="Color" require="Y"><option value="">Select</option><option value="0">Black</option><option value="1">White</option></select>
    <select name="optionlist[]" opt_id="3" opt_mix="Y" label="Size" require="Y"><option value="">Select</option></select>
    <select name="optionlist[]" opt_id="4" opt_mix="Y" label="Gender" require="Y"><option value="">Select</option></select></form>`);
  await page.evaluate(() => {
    const [color, size, gender] = document.querySelectorAll('select');
    color.onchange = () => {
      size.innerHTML = '<option value="">Select</option>' + (color.value === '0' ? '<option value="s">S</option>' : color.value === '1' ? '<option value="l">L</option>' : '');
      gender.innerHTML = '<option value="">Select</option>';
    };
    size.onchange = () => { gender.innerHTML = '<option value="">Select</option>' + (size.value ? '<option value="u">Unisex</option><option value="x" disabled>Sold out</option>' : ''); };
  });
  const matrix = await exploreSelectOptions(page, await page.evaluate(extractProductOptions, {}), { budget: 15000 });
  assert.equal(matrix.explored, true);
  assert.equal(matrix.complete, true);
  assert.equal(matrix.groups[0].sourceOptionId, '2');
  assert.ok(matrix.groups.every(group => group.isCombination === true));
  assert.equal(matrix.groups[2].values.find(choice => choice.id === 'x').disabled, true);
  assert.equal(mixed[0].isCombination, false);
  assert.deepEqual(matrix.groups[0].combinations.map(row => row.values), [
    { 'option-2': '0', 'option-3': 's', 'option-4': 'u' },
    { 'option-2': '1', 'option-3': 'l', 'option-4': 'u' },
  ]);
  assert.deepEqual(await page.locator('select').evaluateAll(elements => elements.map(element => element.value)), ['', '', '']);

  // Empty independent MakeShop selects are backed by product-scoped page state.
  await page.goto('https://fixture.test/shop/shopdetail.html?branduid=123');
  await page.setContent(`<form name="form1">
    <input name="optionlist[]" opt_id="10" label="Name" type="text" value="PRIVATE" require="Y">
    <select name="optionlist[]" opt_id="11" opt_mix="N" label="Consent"><option value="">Select</option></select>
    <select name="optionlist[]" opt_id="12" opt_mix="N" label="Other"><option value="">Select</option></select>
    <select name="optionlist[]" opt_id="13" opt_mix="N" label="Existing"><option value="live">Live</option></select></form>`);
  await page.evaluate(() => {
    const row = { uid: '123', opt_id: '11', opt_type: 'SELECT', opt_mix: 'N', opt_use: 'Y', opt_value: 'Agree', opt_price: '0' };
    window.optionJsonData = { basic: {
      0: { 0: row, 1: { ...row, opt_value: 'Confirm' }, 2: { ...row, opt_use: 'N', opt_value: 'Unused' } },
      1: { 0: { ...row, uid: '999', opt_id: '12' } },
      2: { 0: { ...row, opt_id: '13', opt_value: 'Stale' } },
    } };
  });
  const makeshop = await page.evaluate(extractProductOptions, {});
  assert.equal(makeshop[0].type, 'text');
  assert.ok(!JSON.stringify(makeshop).includes('PRIVATE'));
  assert.deepEqual(makeshop[1].values.map(value => value.label), ['Agree', 'Confirm']);
  assert.equal(makeshop[1].values[0].id, '0');
  assert.equal(makeshop[2].values.length, 0);
  assert.equal(makeshop[3].values[0].label, 'Live');
  await page.goto(identity.url);

  await page.setContent(`<script type="application/json">${JSON.stringify(shopify)}</script>`);
  const complete = await collectOptions(page, { sourceHtml: '', identity, responses: { payloads: [], finish: async () => {} } });
  assert.equal(complete.analysis.status, 'complete');
  assert.equal(complete.groups.length, 2);
  await page.setContent('<h1>Empty fixture</h1>');
  const empty = await collectOptions(page, { sourceHtml: '', identity, responses: { payloads: [], finish: async () => {} } });
  assert.equal(empty.analysis.status, 'unresolved');
  await page.route('https://brand.naver.com/**', route => route.fulfill({ contentType: 'text/html', body: '<main></main>' }));
  await page.goto('https://brand.naver.com/store/products/123');
  await page.setContent(`<div><a aria-haspopup="listbox" aria-expanded="false" data-shp-area="pcs.optselect" data-shp-contents-type="Pack">Pack</a><ul role="listbox"><li><a role="option" data-shp-area="pcs.optselect" data-shp-contents-type="Pack" data-shp-contents-id="1kg">1kg</a></li></ul></div>
    <div><a href="#" aria-haspopup="listbox" aria-expanded="false" data-shp-area="pcs.addedoptselect" data-shp-contents-type="Extras">Extras</a></div>`);
  await page.evaluate(() => {
    document.querySelector('[data-shp-area="pcs.addedoptselect"]').onclick = function(event) {
      event.preventDefault(); this.setAttribute('aria-expanded', 'true');
      this.parentElement.insertAdjacentHTML('beforeend', '<a role="option" data-shp-area="pcs.addedoptselect" data-shp-contents-type="Extras" data-shp-contents-id="Cheese">Cheese (+4,900\uC6D0)</a>');
    };
  });
  const naver = await collectOptions(page, { sourceHtml: '', identity: { ...identity, url: page.url() }, responses: { payloads: [], finish: async () => {} } });
  assert.equal(naver.groups.length, 2);
  assert.equal(naver.groups[0].required, true);
  assert.equal(naver.groups[1].required, false);
  assert.equal(naver.groups[1].values[0].label, 'Cheese');
  assert.equal(naver.groups[1].values[0].priceDelta, 4900);
  await page.goto(identity.url);
  const watcher = watchOptionResponses(page, identity.url);
  await page.route('**/products/shirt.json', (route) => route.fulfill({ json: shopify }));
  await page.evaluate(() => fetch('/products/shirt.json'));
  await watcher.finish();
  assert.equal(watcher.payloads.length, 1);
  console.log('Option collection: OK (mixed UI, delayed DOM, dependent selects, safety guard, bounded traversal, Shopify, WooCommerce, JSON response, uncertainty)');
} finally { await browser.close(); }
