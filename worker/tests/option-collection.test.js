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

  await page.setContent(`<script type="application/json">${JSON.stringify(shopify)}</script>`);
  const complete = await collectOptions(page, { sourceHtml: '', identity, responses: { payloads: [], finish: async () => {} } });
  assert.equal(complete.analysis.status, 'complete');
  assert.equal(complete.groups.length, 2);
  await page.setContent('<h1>Empty fixture</h1>');
  const empty = await collectOptions(page, { sourceHtml: '', identity, responses: { payloads: [], finish: async () => {} } });
  assert.equal(empty.analysis.status, 'unresolved');
  const watcher = watchOptionResponses(page, identity.url);
  await page.route('**/products/shirt.json', (route) => route.fulfill({ json: shopify }));
  await page.evaluate(() => fetch('/products/shirt.json'));
  await watcher.finish();
  assert.equal(watcher.payloads.length, 1);
  console.log('Option collection: OK (mixed UI, delayed DOM, dependent selects, safety guard, bounded traversal, Shopify, WooCommerce, JSON response, uncertainty)');
} finally { await browser.close(); }
