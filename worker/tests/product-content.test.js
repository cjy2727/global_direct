import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { extractProductContent } from '../product-content.js';

// 외부 쇼핑몰이나 운영 데이터를 사용하지 않고 DOM fixture로 실제 Chromium 추출을 검증한다.
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route('**/*', (route) => route.abort());
  const extract = async (html, product = {}) => {
    await page.setContent(`<base href="https://shop.example.test/item/">${html}`);
    return page.evaluate(extractProductContent, { product });
  };
  const result = await extract(`
    <meta property="og:image" content="/social.jpg">
    <main><img src="/unrelated.jpg">
      <div class="product-gallery">
        <img data-main-image src="/placeholder.gif" data-src="/main.jpg">
        <img src="/small.jpg" srcset="/small.jpg 200w, /large.jpg 1200w">
        <div class="recommendations"><img src="/recommended.jpg"></div>
        <img src="/icon.jpg" width="16" height="16">
      </div>
      <div class="product-description" data-product-description>
        <h2>상품 특징</h2><p>면 100% <strong>소재</strong></p>
        <img src="/loading.gif" data-original="/detail.jpg">
        <table><tr><th>크기</th><td>20 × 30 cm</td></tr></table>
        <div class="reviews"><p>광고 리뷰</p><img src="/review.jpg"></div>
        <script type="application/json">SECRET_SCRIPT</script>
        <iframe src="about:blank"></iframe>
        <a href="javascript:alert(1)" onclick="alert(1)">원본 문구</a>
      </div>
    </main>`, { image: '/structured.jpg' });
  assert.deepEqual(result.images, ['https://shop.example.test/main.jpg', 'https://shop.example.test/large.jpg']);
  assert.equal(result.mainImage, result.images[0]);
  assert.equal(result.content.imageSource, 'gallery');
  assert.deepEqual(result.content.blocks.map((block) => block.type), ['heading', 'text', 'image', 'specification', 'text']);
  assert.equal(result.content.blocks[2].url, 'https://shop.example.test/detail.jpg');
  assert.equal(result.content.blocks[3].name, '크기');
  assert.equal(JSON.stringify(result).includes('SECRET_SCRIPT'), false);
  assert.equal(JSON.stringify(result).includes('javascript:'), false);

  const schema = await extract('<main><img src="/unrelated.jpg"></main>', {
    image: [{ contentUrl: '/schema-main.jpg' }, '/schema-other.jpg'],
    description: '<p>원본 설명</p><script>DO_NOT_COPY</script>',
    additionalProperty: [{ name: '소재', value: '면' }],
  });
  assert.equal(schema.mainImage, 'https://shop.example.test/schema-main.jpg');
  assert.equal(schema.content.blocks[0].text, '원본 설명');
  assert.equal(schema.content.blocks[1].type, 'specification');
  const social = await extract('<meta property="og:image" content="/social.jpg">');
  assert.equal(social.content.imageSource, 'open_graph');
  const empty = await extract('<main><img src="/random.jpg"></main>', { image: ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'https://user:pass@example.test/image.jpg'] });
  assert.deepEqual(empty.images, []);
  assert.equal(empty.content.status, 'unavailable');
  const limit = await extract(`<div class="product-description">${Array.from({ length: 40 }, (_, i) => `<img data-src="/${i}.jpg">`).join('')}</div>`);
  assert.equal(limit.content.blocks.length, 24);
  const makeshop = await extract(`
    <div id="productDetail">
      <table><tr><th>현재 위치</th><td>HOME &gt; 상품</td></tr></table>
      <img src="/top-banner.jpg">
      <div class="detailTab">상품정보 리뷰 Q&amp;A 배송/교환/반품</div>
      <div class="prd-detail"><h2>실제 상품 설명</h2><img src="/actual-detail.jpg"><p>소재와 구성품</p></div>
      <div class="detailTab">REVIEW + MORE</div><p>등록된 문의가 없습니다.</p>
      <img src="/shipping-guide.jpg">
    </div>`, { image: '/main.jpg' });
  assert.deepEqual(makeshop.content.blocks.map((block) => block.type), ['heading', 'image', 'text']);
  assert.equal(makeshop.content.blocks[0].text, '실제 상품 설명');
  assert.equal(makeshop.content.blocks[1].url, 'https://shop.example.test/actual-detail.jpg');
  assert.equal(JSON.stringify(makeshop.content).includes('현재 위치'), false);
  assert.equal(JSON.stringify(makeshop.content).includes('shipping-guide'), false);
  console.log('Product content Chromium fixtures: OK');
} finally {
  await browser.close();
}
