import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractProductOptions } from '../product-options.js';
import { applyOptionFallback } from '../option-fallback.js';

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('https://fixture.shop.blogpay.co.kr/**', route => route.fulfill({ contentType: 'text/html', body: '' }));
  await page.goto('https://fixture.shop.blogpay.co.kr/good/product_view?goodNum=123');
  await page.setContent(`
    <select id="color" name="noOption[1]" optionType="noOption" optionTitle="Color" class="optionRequire">
      <option value="">Color</option><option value="black" title="Black" price="20000">Black (+20,000)</option></select>
    <select id="size" name="noOption[2]" optionType="noOption" optionTitle="Size" class="optionRequire" disabled>
      <option value="">Size</option><option value="s" price="">S</option></select>
    <select id="material" optionType="noOption" optionTitle="Material" class="optionRequire" disabled><option value="cotton">Cotton</option></select>
    <input type="text" id="text1" optionType="ioOption" optionTitle="Text 1" price="5000" class="optionRequireInput" value="PRIVATE">
    <input type="text" id="text2" optionType="ioOption" optionTitle="Text 2" price="10000" class="optionRequireInput" disabled value="PRIVATE">
    <select id="extra1" optionType="noOption" optionTitle="Extra 1" class="optionAdditional"><option value="wrap" price="1000">Wrap</option></select>
    <select id="extra2" optionType="noOption" optionTitle="Extra 2" class="optionAdditional"><option value="card" price="">Card</option></select>
    <nav><select optionType="noOption" optionTitle="Navigation"><option value="bad">Bad</option></select></nav>`);
  const groups = await page.evaluate(extractProductOptions, {});
  assert.equal(groups.length, 7);
  assert.deepEqual(groups.map(group => group.name), ['Color','Size','Material','Text 1','Text 2','Extra 1','Extra 2']);
  assert.deepEqual(groups.map(group => group.required), [true,true,true,true,true,false,false]);
  assert.equal(groups[0].values[0].label, 'Black');
  assert.equal(groups[0].values[0].priceDelta, 20000);
  assert.equal(groups[1].values[0].priceDelta, null);
  assert.equal(groups[1].unavailable, false);
  assert.equal(groups[1].pendingSelection, true);
  assert.equal(groups[3].priceDelta, 5000);
  assert.equal(groups[4].type, 'text');
  assert.equal(groups[4].unavailable, false);
  assert.equal(groups[4].pendingSelection, true);
  assert.equal(groups[5].isAdditional, true);
  assert.equal(JSON.stringify(groups).includes('PRIVATE'), false);
  const fallback = applyOptionFallback({ optionGroups: groups, optionAnalysis: { status: 'partial' } }, { controls: [{ name: ' Size ' }, { name: ' Text 2 ' }] });
  assert.equal(fallback.optionFallback.fields.filter(field => field.name === 'Size').length, 1);
  assert.ok(!fallback.optionFallback.fields.some(field => ['Text 1', 'Text 2'].includes(field.name)));
  assert.equal(fallback.optionFallback.fields.find(field => field.name === 'Size').type, 'text');
  console.log('Blogpay option fixture passed');
} finally { await browser.close(); }
