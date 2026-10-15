import assert from 'node:assert/strict';
import { chromium } from 'playwright';
let html = '';
for await (const chunk of process.stdin) html += chunk;
assert.ok(html.includes('data-option-combinations'));
const script = await (await fetch('http://nginx/assets/app.js')).text();
assert.ok(script.includes('syncOptionCombinations'), 'Current app.js must be served');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const width of [1280, 390]) {
    await page.goto('about:blank');
    await page.setViewportSize({ width, height: 900 });
    await page.setContent(html);
    await page.addScriptTag({ content: script });
    assert.deepEqual(errors, []);
    await page.locator('[data-option-id="color"]').selectOption('black');
    assert.equal(await page.locator('[data-option-id="size"] option[value="L"]').evaluate((option) => option.disabled), true);
    assert.equal(await page.locator('[data-option-id="size"] option[value="M"]').evaluate((option) => option.disabled), true);
    await page.locator('[data-option-id="size"]').selectOption('S');
    await page.locator('[data-option-id="color"]').selectOption('white');
    assert.equal(await page.locator('[data-option-id="size"]').inputValue(), '');
    assert.equal(await page.locator('[data-option-id="size"] option[value="L"]').evaluate((option) => option.disabled), false);
    await page.locator('[data-option-id="size"]').selectOption('L');
    assert.equal(await page.locator('form').evaluate((form) => form.checkValidity()), true);
  }
  console.log('Combination UI: OK (real PHP template + app.js, desktop/mobile, sold-out and invalid choices, selection reset)');
} finally { await browser.close(); }
