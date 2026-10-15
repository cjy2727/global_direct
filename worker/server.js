import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import { chromium } from 'playwright';
import { extractProductContent } from './product-content.js';
import { collectOptions, waitForOptions, watchOptionResponses } from './option-collector.js';

const PORT = 3000;
const TOKEN = process.env.WORKER_TOKEN || '';
const MAX_BODY = 16 * 1024;

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 10
      || p[0] === 127
      || p[0] === 0
      || (p[0] === 169 && p[1] === 254)
      || (p[0] === 172 && p[1] >= 16 && p[1] <= 31)
      || (p[0] === 192 && p[1] === 168)
      || (p[0] === 100 && p[1] >= 64 && p[1] <= 127)
      || p[0] >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === '::1'
    || normalized === '::'
    || normalized.startsWith('fc')
    || normalized.startsWith('fd')
    || normalized.startsWith('fe80:')
    || normalized.startsWith('::ffff:127.')
    || normalized.startsWith('::ffff:10.')
    || normalized.startsWith('::ffff:192.168.');
}

async function assertPublicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) throw new Error('상품 URL이 올바르지 않습니다.');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('HTTP 또는 HTTPS 상품 URL만 사용할 수 있습니다.');
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateIp(address))) throw new Error('내부 네트워크 주소는 사용할 수 없습니다.');
  return url;
}

function parsePrice(value) {
  if (value == null) return null;
  const cleaned = String(value).replace(/[^0-9.,]/g, '').replace(/,/g, '');
  const number = Number.parseFloat(cleaned);
  // Preserve source precision before applying the quote currency's rounding rules.
  return Number.isFinite(number) && number > 0 ? Number(number.toFixed(4)) : null;
}

async function analyze(rawUrl) {
  await assertPublicUrl(rawUrl);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR', userAgent: 'GlobalDirectProductReader/1.0' });
  const page = await context.newPage();
  const optionResponses = watchOptionResponses(page, rawUrl);
  page.setDefaultTimeout(8000);
  await page.route('**/*', async (route) => {
    try {
      const requestUrl = new URL(route.request().url());
      if (!['http:', 'https:'].includes(requestUrl.protocol)) return route.abort('blockedbyclient');
      await assertPublicUrl(requestUrl.href);
      if (['font', 'media'].includes(route.request().resourceType())) return route.abort('blockedbyclient');
      return route.continue();
    } catch { return route.abort('blockedbyclient'); }
  });

  try {
    const response = await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    const sourceUrl = new URL(rawUrl);
    const isCoupang = sourceUrl.hostname === 'coupang.com' || sourceUrl.hostname.endsWith('.coupang.com');
    if (response?.status() === 403 && isCoupang) {
      const productId = sourceUrl.pathname.match(/^\/vp\/products\/(\d+)/)?.[1];
      const canonicalUrl = productId ? `${sourceUrl.origin}/vp/products/${productId}` : rawUrl;
      return {
        title: productId ? `쿠팡 상품 #${productId}` : '쿠팡 상품',
        price: null,
        currency: 'KRW',
        images: [],
        optionGroups: [],
        description: '쿠팡의 자동화 접근 제한으로 상품 정보를 자동 확인하지 못했습니다.',
        canonicalUrl,
        availability: '',
        sourceUrl: rawUrl,
        finalUrl: canonicalUrl,
        status: 'needs_review'
      };
    }
    if (!response || response.status() >= 400) throw new Error(`상품 페이지 응답 오류 (${response?.status() || '응답 없음'})`);
    // 이동 전에 응답을 읽되, 본문을 읽지 못해도 현재 DOM 분석은 계속한다.
    const sourceHtml = await response.text().catch(() => null);
    await waitForOptions(page);
    const result = await page.evaluate(() => {
      const text = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      const products = [];
      for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(node.textContent || 'null');
          const visit = (item) => {
            if (!item || typeof item !== 'object') return;
            if (Array.isArray(item)) return item.forEach(visit);
            if (['Product', 'ProductGroup'].includes(item['@type']) || (Array.isArray(item['@type']) && item['@type'].some((type) => ['Product', 'ProductGroup'].includes(type)))) products.push(item);
            if (item['@graph']) visit(item['@graph']);
            if (item.mainEntity) visit(item.mainEntity);
          };
          visit(parsed);
        } catch {}
      }
      // 추천 상품이 먼저 선언된 페이지에서는 현재 URL/제목과 일치하는 상품을 우선한다.
      const currentUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
      const heading = text(document.querySelector('h1')?.textContent).toLowerCase();
      const productScore = (item) => {
        let score = 0;
        for (const candidate of [item.url, item['@id'], item.mainEntityOfPage?.['@id']]) {
          try {
            const url = new URL(candidate, location.href);
            const current = new URL(currentUrl);
            if (url.origin === current.origin && url.pathname === current.pathname) score += 10;
          } catch {}
        }
        if (heading && text(item.name).toLowerCase() === heading) score += 5;
        return score;
      };
      const product = products.sort((a, b) => productScore(b) - productScore(a))[0] || {};
      const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
      const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
      const hostname = location.hostname.toLowerCase();
      const isRakuten = hostname === 'rakuten.co.jp' || hostname.endsWith('.rakuten.co.jp');
      const title = text(product.name) || text(meta('meta[property="og:title"]')) || text(document.querySelector('h1')?.textContent) || text(document.title);
      const priceValues = [
        offer.price,
        offer.lowPrice,
        meta('meta[property="product:price:amount"]'),
        document.querySelector('[itemprop="price"]')?.getAttribute('content'),
        document.querySelector('[itemprop="price"]')?.textContent,
      ];
      let price = priceValues.find((value) => value != null && String(value).trim() !== '') || null;
      let currency = text(offer.priceCurrency) || text(meta('meta[property="product:price:currency"]'));
      const bodyText = (document.body?.innerText || '').slice(0, 160000);
      if (!price) {
        const yenMatch = bodyText.match(/(?:¥|￥|JPY\s*)([0-9][0-9,]*)|([0-9][0-9,]*)\s*円/);
        const wonMatch = bodyText.match(/(?:₩|KRW\s*|￦\s*)([0-9][0-9,]*)|([0-9][0-9,]*)\s*원/);
        const dollarMatch = bodyText.match(/(?:US\$|USD\s*|\$\s*)([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i);
        if (yenMatch) { price = yenMatch[1] || yenMatch[2]; currency = currency || 'JPY'; }
        else if (wonMatch) { price = wonMatch[1] || wonMatch[2]; currency = currency || 'KRW'; }
        else if (dollarMatch) { price = dollarMatch[1]; currency = currency || 'USD'; }
      }
      if (!currency) {
        if (isRakuten || /¥|￥|円|JPY/.test(bodyText)) currency = 'JPY';
        else if (/₩|원|KRW/.test(bodyText)) currency = 'KRW';
        else currency = /US\$|USD|\$\s*[0-9]/i.test(bodyText) ? 'USD' : 'UNKNOWN';
      }
      return {
        title,
        price,
        currency,
        structuredProduct: product,
        description: text(product.description) || text(meta('meta[property="og:description"]')),
        canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || location.href,
        availability: text(offer.availability),
      };
    });
    const content = await page.evaluate(extractProductContent, { product: result.structuredProduct });
    delete result.structuredProduct;
    const price = parsePrice(result.price);
    const currency = String(result.currency || 'UNKNOWN').trim().toUpperCase();
    const options = await collectOptions(page, { sourceHtml, responses: optionResponses, identity: { url: page.url(), title: result.title, price, currency } });
    return { ...result, ...content, optionGroups: options.groups, optionAnalysis: options.analysis,
      price, currency, sourceUrl: rawUrl, finalUrl: page.url(),
      status: result.title && price && ['complete', 'none'].includes(options.analysis.status) ? 'complete' : 'needs_review' };
  } finally {
    await optionResponses.finish();
    await context.close();
    await browser.close();
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (req.method === 'GET' && req.url === '/health') return res.end(JSON.stringify({ ok: true }));
  if (req.method !== 'POST' || req.url !== '/analyze') { res.statusCode = 404; return res.end(JSON.stringify({ ok: false, message: '경로를 찾을 수 없습니다.' })); }
  if (!TOKEN || req.headers['x-worker-token'] !== TOKEN) { res.statusCode = 403; return res.end(JSON.stringify({ ok: false, message: '접근할 수 없습니다.' })); }
  let body = '';
  req.on('data', (chunk) => { body += chunk; if (body.length > MAX_BODY) req.destroy(); });
  req.on('end', async () => {
    try { const input = JSON.parse(body); const product = await analyze(input.url); res.end(JSON.stringify({ ok: true, product })); }
    catch (error) { res.statusCode = 422; res.end(JSON.stringify({ ok: false, message: error.message || '상품 페이지를 분석하지 못했습니다.' })); }
  });
});

server.listen(PORT, '0.0.0.0');
