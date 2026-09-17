import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractProductOptions } from '../product-options.js';

// 원본과 같은 속성을 가진 비식별 fixture로 입력값 미수집과 옵션 메타데이터를 검증한다.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const html = Array.from({ length: 4 }, (_, i) => `<input name="optionlist[]" opt_id="${i}" label="${i === 3 ? '이메일' : '입력 ' + i}" require="Y" value="DO_NOT_COLLECT">`).join('')
    + Array.from({ length: 5 }, (_, i) => `<select name="optionlist[]" opt_id="${i + 4}" label="동의 ${i}" opt_mandatory="Y"><option value="">선택</option><option value="yes" price="0">동의합니다</option><option value="sold" price="1,500" disabled>품절</option></select>`).join('');
  await page.setContent(html);
  const groups = await page.evaluate(extractProductOptions, {});
  assert.equal(groups.length, 9);
  assert.equal(groups.filter((g) => g.type === 'text').length, 4);
  assert.ok(groups.every((g) => g.required));
  assert.equal(groups[3].inputType, 'email');
  assert.equal(groups[4].values[0].priceDelta, 0);
  assert.equal(groups[4].values[1].priceDelta, 1500);
  assert.equal(groups[4].values[1].disabled, true);
  assert.ok(!JSON.stringify(groups).includes('DO_NOT_COLLECT'));
  assert.deepEqual(await page.evaluate(extractProductOptions, { html }), groups);
  console.log('ProductOptions extraction: OK (9 fixture fields)');
} finally {
  await browser.close();
}
