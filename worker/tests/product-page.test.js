import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// PHP가 실제로 렌더링한 fixture HTML을 stdin으로 받아 PC/모바일 화면을 검증한다.
let html = '';
for await (const chunk of process.stdin) html += chunk;
assert.ok(html.includes('id="product-description"'));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === 'nginx' && url.pathname === '/__product_fixture') {
      return route.fulfill({ contentType: 'text/html; charset=utf-8', body: html });
    }
    if (url.hostname === 'images.example.test') {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1000"><rect width="800" height="1000" fill="#eef1ed"/><text x="150" y="200" font-size="42">Product fixture</text></svg>';
      return route.fulfill({ contentType: 'image/svg+xml', body: svg });
    }
    if (url.hostname === 'nginx' && url.pathname.startsWith('/assets/')) {
      const response = await fetch(url.href);
      return route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: Buffer.from(await response.arrayBuffer()) });
    }
    return route.abort();
  });
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://nginx/__product_fixture');
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.product-detail')).display === 'grid', null, { timeout: 5000 });
    await page.locator('#product-description').scrollIntoViewIfNeeded();
    await page.waitForFunction(() => [...document.images].every((image) => image.complete));
    assert.equal(await page.locator('.product-gallery img').count(), 3);
    await page.locator('.thumbnail').nth(1).click();
    assert.ok((await page.locator('#main-product-image').getAttribute('src')).endsWith('/side.jpg'));
    assert.equal(await page.locator('.product-description-content img').count(), 1);
    assert.equal(await page.locator('.product-specification dt').textContent(), '크기');
    const overflow = await page.evaluate(() => [...document.querySelectorAll('body *')]
      .filter((node) => node.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8).map((node) => `${node.tagName}.${node.className}: ${Math.round(node.getBoundingClientRect().right)}`));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `width=${width}: ${overflow.join(', ')}`);
    await page.locator('a[href="#purchase-guide"]').click();
    await page.waitForURL((url) => url.hash === '#purchase-guide');
    assert.equal(new URL(page.url()).hash, '#purchase-guide');
  }
  assert.deepEqual(errors, []);
  console.log('Product page desktop/mobile Chromium checks: OK');
} finally {
  await browser.close();
}
