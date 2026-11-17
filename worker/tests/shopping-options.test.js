import assert from 'node:assert/strict';
import { normalizeApiOptions } from '../shopping-options.js';
import { normalizeShoppingProduct } from '../global-shopping.js';
import { applyOptionFallback } from '../option-fallback.js';
import { makeshopFixture } from './fixtures/makeshop-product.js';

const url = 'https://shop.example.test/shop/shopdetail.html?branduid=123';
const fixture = makeshopFixture();
const product = normalizeShoppingProduct(fixture, url, url);
assert.equal(product.optionAnalysis.status, 'complete');
assert.equal(product.optionGroups.length, 3);
assert.equal(product.optionGroups[0].combinations.length, 8);
assert.equal(product.optionGroups[0].combinations.filter(row => row.disabled).length, 1);
assert.equal(product.optionGroups[0].combinations.find(row => row.values['option-44'] === '0' && row.values['option-31'] === '0' && row.values['option-29'] === '1').priceDelta, 14000);
assert.equal(product.optionGroups[1].values[1].disabled, false); // A hidden combination does not globally hide Large.
assert.equal(product.optionGroups[1].values[1].priceDelta, null); // Combination deltas are not independent prices.
assert.equal(applyOptionFallback(product).optionFallback.status, 'not_needed');
assert.equal(product.additionalProducts.length, 6);
assert.equal(product.additionalProducts[0].title, 'Extra 1');
assert.equal(product.additionalProducts[0].required, false);
assert.equal(product.additionalProducts[0].optionAnalysis.status, 'complete');
assert.equal(product.additionalProducts[0].optionGroups[0].values[0].priceDelta, 34900);
assert.equal(product.additionalProducts[0].optionGroups[0].values[1].disabled, true);
assert.equal(product.additionalProducts[0].optionGroups[0].isCombination, false);

for (const modify of [p => p.basic.pop(), p => p.basic.push({ ...p.basic[0] }), p => { p.basic[0].sto_price = ''; },
  p => { p.basic[0].sto_opt_values = 'Unrelated,Small,Single'; }, p => { p.basic[0].sto_state_code = ''; }, p => { p.basic = {}; }]) {
  const options = structuredClone(fixture.products[0].options); modify(options);
  assert.equal(normalizeApiOptions(options).status, 'partial');
}
const missing = structuredClone(fixture.products[1].options); missing.addition.pop();
assert.equal(normalizeApiOptions(missing).status, 'partial');
assert.equal(normalizeApiOptions(missing).groups[0].hasUnresolvedValues, true);
assert.equal(normalizeApiOptions(missing).groups[0].values[1].unresolved, true);
const missingFixture = makeshopFixture(); missingFixture.products[1].options.addition.pop();
const partialAddition = normalizeShoppingProduct(missingFixture, url, url).additionalProducts[0];
assert.equal(partialAddition.optionFallback.status, 'manual_input');
assert.equal(partialAddition.optionGroups[0].values[0].priceDelta, 34900);
const stock = structuredClone(fixture.products[1].options);
Object.assign(stock.addition[0], { sto_unlimit: 'N', sto_stop_use: 'Y', sto_real_stock: '0' });
assert.equal(normalizeApiOptions(stock).groups[0].values[0].disabled, true);
stock.addition[0].sto_stop_use = 'N';
assert.equal(normalizeApiOptions(stock).groups[0].values[0].disabled, false);
console.log('API combination matrix, hidden rows, joint prices, six additions and incomplete-data fixtures passed');
