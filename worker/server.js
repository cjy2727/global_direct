import http from 'node:http';
import dns from 'node:dns/promises';
import net from 'node:net';
import { chromium } from 'playwright';

const PORT = 3000;
const TOKEN = process.env.WORKER_TOKEN || '';
const MAX_BODY = 16 * 1024;

function isPrivateIp(address) {
  if (net.isIPv4(address)) {
    const p = address.split('.').map(Number);
    return p[0] === 10 || p[0] === 127 || p[0] === 0 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127) || p[0] >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:') || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
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
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

async function analyze(rawUrl) {
  await assertPublicUrl(rawUrl);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'ko-KR', userAgent: 'GlobalDirectProductReader/1.0' });
  const page = await context.newPage();
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
    await page.waitForTimeout(1200);
    const result = await page.evaluate(() => {
      const text = (value) => typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
      const absolute = (value) => { try { return new URL(value, location.href).href; } catch { return null; } };
      const products = [];
      for (const node of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const parsed = JSON.parse(node.textContent || 'null');
          const visit = (item) => {
            if (!item || typeof item !== 'object') return;
            if (Array.isArray(item)) return item.forEach(visit);
            if (item['@type'] === 'Product' || (Array.isArray(item['@type']) && item['@type'].includes('Product'))) products.push(item);
            if (item['@graph']) visit(item['@graph']);
          };
          visit(parsed);
        } catch {}
      }
      const product = products[0] || {};
      const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
      const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
      const hostname = location.hostname.toLowerCase();
      const isRakuten = hostname === 'rakuten.co.jp' || hostname.endsWith('.rakuten.co.jp');
      const title = text(product.name) || text(meta('meta[property="og:title"]')) || text(document.querySelector('h1')?.textContent) || text(document.title);
      const priceValues = [offer.price, offer.lowPrice, meta('meta[property="product:price:amount"]'), document.querySelector('[itemprop="price"]')?.getAttribute('content'), document.querySelector('[itemprop="price"]')?.textContent];
      let price = priceValues.find((value) => value != null && String(value).trim() !== '') || null;
      let currency = text(offer.priceCurrency) || text(meta('meta[property="product:price:currency"]'));
      const bodyText = (document.body?.innerText || '').slice(0, 160000);
      if (!price) {
        const yenMatch = bodyText.match(/(?:¥|￥|JPY\s*)([0-9][0-9,]*)|([0-9][0-9,]*)\s*円/);
        const wonMatch = bodyText.match(/(?:₩|KRW\s*|￦\s*)([0-9][0-9,]*)|([0-9][0-9,]*)\s*원/);
        if (yenMatch) { price = yenMatch[1] || yenMatch[2]; currency = currency || 'JPY'; }
        else if (wonMatch) { price = wonMatch[1] || wonMatch[2]; currency = currency || 'KRW'; }
      }
      if (!currency) {
        if (isRakuten || /¥|￥|円|JPY/.test(bodyText)) currency = 'JPY';
        else currency = /₩|원|KRW/.test(bodyText) ? 'KRW' : 'UNKNOWN';
      }
      const imageCandidates = [];
      const addImage = (value) => {
        if (Array.isArray(value)) return value.forEach(addImage);
        if (value && typeof value === 'object') return addImage(value.url || value.contentUrl);
        const raw = text(value == null ? '' : String(value));
        if (!raw || /^(?:undefined|null|about:blank)$/i.test(raw)) return;
        const url = absolute(raw);
        if (url?.startsWith('http') && !/\/(?:undefined|null)(?:[?#]|$)/i.test(url)) imageCandidates.push(url);
      };
      addImage(product.image); addImage(meta('meta[property="og:image"]'));
      for (const img of document.querySelectorAll('main img, [class*="product"] img, [id*="product"] img')) addImage(img.currentSrc || img.src || img.dataset.src || img.dataset.original);
      const images = [...new Set(imageCandidates)].filter((url) => !url.startsWith('data:')).slice(0, 12);
      const optionGroups = [];
      const addGroup = (name, values) => {
        const rawName = text(typeof name === 'object' ? (name.target || name.origin) : name);
        const cleanName = isRakuten && /^radioGroup-/i.test(rawName) ? '구매 방식' : (rawName || '옵션');
        const cleanValues = [...new Set((values || []).map((value) => {
          const rawValue = text(typeof value === 'object' ? (value.name?.target || value.name?.origin || value.label || value.title || value.value) : value);
          if (!isRakuten) return rawValue;
          if (rawValue.toLowerCase() === 'normal') return '일반 구매';
          if (rawValue.toLowerCase() === 'subscription') return '정기 구매';
          return rawValue;
        }).filter(Boolean))].slice(0, 30);
        if (!cleanValues.length || cleanValues.every((value) => /^(?:🇯🇵|🇰🇷|한국어|일본어|한국|일본|ko|ja)$/i.test(value))) return;
        if (!optionGroups.some((group) => group.name === cleanName && JSON.stringify(group.values) === JSON.stringify(cleanValues))) optionGroups.push({ name: cleanName, values: cleanValues });
      };
      for (const select of document.querySelectorAll('select')) {
        const options = [...select.options].map((o) => text(o.textContent)).filter((v) => v && !/선택|select|choose/i.test(v)).slice(0, 30);
        const name = text(select.labels?.[0]?.textContent) || text(select.getAttribute('aria-label')) || text(select.name);
        if (name) addGroup(name, options);
      }
      const radioGroups = new Map();
      for (const radio of document.querySelectorAll('input[type="radio"]')) {
        const name = radio.name || '옵션';
        const label = text(radio.labels?.[0]?.textContent) || text(radio.value);
        if (label) radioGroups.set(name, [...(radioGroups.get(name) || []), label]);
      }
      for (const [name, values] of radioGroups) addGroup(name, values);
      const visitState = (item, seen = new Set()) => {
        if (!item || typeof item !== 'object' || seen.has(item) || seen.size > 15000) return;
        seen.add(item);
        if (!Array.isArray(item) && Array.isArray(item.values)) addGroup(item.groupName || item.name || item.label, item.values);
        if (Array.isArray(item)) item.forEach((value) => visitState(value, seen));
        else Object.values(item).forEach((value) => visitState(value, seen));
      };
      for (const entry of (window.__next_f || [])) {
        const chunk = entry?.[1];
        if (typeof chunk !== 'string' || !/option|variant/i.test(chunk)) continue;
        for (const line of chunk.split('\n')) {
          const separator = line.indexOf(':');
          if (separator < 1) continue;
          try { visitState(JSON.parse(line.slice(separator + 1))); } catch {}
        }
      }
      return { title, price, currency, images, optionGroups: optionGroups.slice(0, 8), description: text(product.description) || text(meta('meta[property="og:description"]')), canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || location.href, availability: text(offer.availability) };
    });
    const price = parsePrice(result.price);
    return { ...result, price, sourceUrl: rawUrl, finalUrl: page.url(), status: result.title && price ? 'complete' : 'needs_review' };
  } finally {
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
