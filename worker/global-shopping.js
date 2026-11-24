import { normalizeApiOptions } from './shopping-options.js';
import { applyOptionFallback } from './option-fallback.js';

const isAdditionalProduct = item => item && ['add', 'addition'].includes(item.opt_type) && typeof item.product_name === 'string';

/** Only the existing production widget's own product requests are observed. */
const hostList = ['app.malltail.com', 'app2.malltail.com'];
const hosts = new Set(hostList);
export function watchShoppingResponses(page) {
  const candidates = [];
  const pending = new Set();
  const requests = new Map();
  let disposed = false;
  const key = (uid, action = 'product') => `${action}:${uid}`;
  const productUrl = raw => {
    try { const url = new URL(raw); return hosts.has(url.hostname) && url.pathname === '/global_shopping/api.php'
      && ['product', 'product.addition'].includes(url.searchParams.get('a')) ? url : null; } catch { return null; }
  };
  const requestListener = request => {
    const url = productUrl(request.url());
    if (!url) return;
    const uid = key(url.searchParams.get('uid'), url.searchParams.get('a'));
    const previous = requests.get(uid);
    requests.set(uid, { count: (previous?.count || 0) + 1, failure: null });
  };
  const failedListener = request => {
    const url = productUrl(request.url());
    if (url) { const id = key(url.searchParams.get('uid'), url.searchParams.get('a')); requests.set(id, { ...requests.get(id), failure: 'network_error' }); }
  };
  const fail = (uid, reason) => requests.set(uid, { ...requests.get(uid), failure: reason });
  const listener = response => {
    const url = productUrl(response.url());
    if (!url) return;
    const uid = key(url.searchParams.get('uid'), url.searchParams.get('a'));
    if (!response.ok()) { fail(uid, 'http_error'); return; }
    const job = (async () => {
      try {
        const payload = await response.json();
        const product = payload?.data?.[0];
        if (!disposed && payload?.status === 'success' && product && typeof product === 'object'
          && typeof product.product_name === 'string' && product.product_name.trim()
          && String(product.uid) === url.searchParams.get('uid')) {
          candidates.push({ products: payload.data, uid: String(product.uid), action: url.searchParams.get('a'), platform: url.searchParams.get('_') || '', page: url.searchParams.get('page') });
        } else fail(uid, payload?.status !== 'success' ? 'api_error' : 'invalid_product');
      } catch { fail(uid, 'invalid_json'); }
    })();
    pending.add(job);
    job.finally(() => pending.delete(job));
  };
  page.on('response', listener);
  page.on('request', requestListener);
  page.on('requestfailed', failedListener);
  return {
    async find(uid, pageUrl, action = 'product') {
      await Promise.allSettled([...pending]);
      return candidates.find(candidate => candidate.action === action && (uid ? candidate.uid === uid : candidate.page === pageUrl)) || null;
    },
    state(uid, action = 'product') { return requests.get(key(uid, action)) || { count: 0, failure: null }; },
    dispose() { disposed = true; page.off('response', listener); page.off('request', requestListener); page.off('requestfailed', failedListener); },
  };
}

/** Bounded initialization, consent, and read-only fetchProduct; never a cart-add action. */
export async function readShoppingProduct(page, capture, sourceUrl, { timeout = 12000, additionTimeout = 15000, diagnostics = {} } = {}) {
  const started = Date.now();
  Object.assign(diagnostics, { status: 'pending', stage: 'discover', attempts: 0, requestCount: 0 });
  const fallback = reason => {
    Object.assign(diagnostics, { status: 'fallback', reason, elapsedMs: Date.now() - started });
    return null;
  };
  const deadline = Date.now() + timeout;
  const remaining = () => Math.max(1, deadline - Date.now());
  const convert = async candidate => {
    const base = candidate.products[0];
    const composition = Array.isArray(base.add_composition) ? base.add_composition : [];
    const addition = { status: 'none' };
    if (composition.length || base.addition_exist === true || base.addition_exist === 'Y' || base.is_add_composition === true || base.is_add_composition === 'Y') {
      addition.status = 'partial';
      addition.reason = 'response_timeout';
      // Give additional products their own bounded response window.
      const until = Date.now() + additionTimeout;
      let lastCall = 0;
      let attempts = 0;
      try {
        while (Date.now() < until) {
          const found = await capture.find(candidate.uid, page.url(), 'product.addition');
          if (found) {
            candidate = found;
            addition.status = 'complete';
            delete addition.reason;
            const returned = new Set(found.products.slice(1).filter(isAdditionalProduct).map(item => String(item.uid)));
            if (!returned.size || composition.some(item => !returned.has(String(item.uid)))) {
              addition.status = 'partial';
              addition.reason = 'incomplete_products';
            }
            break;
          }
          const state = capture.state(candidate.uid, 'product.addition');
          if (state.failure) { addition.reason = state.failure; break; }
          if (!state.count && attempts < 3 && Date.now() - lastCall >= 500) {
            const invoked = await page.evaluate(({ uid, products, hostList }) => {
              const mt = window.__MT__;
              if (!mt || !hostList.includes(mt.scriptHost)
                || String(mt.UID || '') !== uid || mt.isRequestInProgress) return 'busy';
              if (typeof mt.fetchProductAddition !== 'function') return 'missing';
              // The existing widget sends its current productInfo with the addition query.
              mt.pifo = products;
              void Promise.resolve(mt.fetchProductAddition()).catch(() => {});
              return 'called';
            }, { uid: candidate.uid, products: candidate.products, hostList });
            if (invoked === 'missing') { addition.reason = 'function_missing'; break; }
            if (invoked === 'called') { attempts++; lastCall = Date.now(); }
          }
          await page.waitForTimeout(Math.max(1, Math.min(100, until - Date.now())));
        }
      } catch { addition.reason = 'widget_error'; }
    }
    const product = normalizeShoppingProduct(candidate, sourceUrl, page.url());
    if (product.additionalProducts.length && addition.status === 'none') addition.status = 'complete';
    if (product.additionalProducts.some(item => item.optionAnalysis.status === 'partial')) {
      addition.status = 'partial'; addition.reason = 'incomplete_options';
    }
    product.additionAnalysis = addition;
    if (addition.status === 'partial') product.status = 'needs_review';
    if (product.productContent) {
      // Parse only the captured API HTML in a detached document, never the storefront DOM.
      const detail = await page.evaluate(({ html, base }) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.querySelectorAll('script,style,iframe').forEach(node => node.remove());
        const description = (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
        const blocks = description ? [{ type: 'text', text: description }] : [];
        for (const img of doc.querySelectorAll('img')) {
          const src = img.getAttribute('data-src') || img.getAttribute('src');
          try { const url = new URL(src, base); if (src && /^https?:$/.test(url.protocol)) blocks.push({ type: 'image', url: url.href }); } catch {}
        }
        return { description, content: { blocks } };
      }, { html: product.productContent, base: page.url() });
      Object.assign(product, detail);
    }
    Object.assign(diagnostics, { status: 'success', stage: 'complete', elapsedMs: Date.now() - started });
    product.shoppingAnalysis = { ...diagnostics };
    return product;
  };
  try {
    // Allow asynchronously inserted widgets a short opportunity to appear.
    await page.waitForFunction(hostList => !!window.__MT__ || [...document.scripts].some(script => {
      try { const u = new URL(script.src); return hostList.includes(u.hostname) && u.pathname.startsWith('/global_shopping/'); } catch { return false; }
    }), hostList, { timeout: Math.min(1500, remaining()) }).catch(() => {});
    // No store/platform registry: discover the installed production widget from the page.
    const installed = await page.locator('script[src]').evaluateAll((scripts, hostList) => scripts.some(script => {
      try {
        const url = new URL(script.src);
        return hostList.includes(url.hostname)
          && /^\/global_shopping\/(?:js\/)?script(?:-min)?\.(?:js|php)$/.test(url.pathname);
      } catch { return false; }
    }), hostList);
    if (!installed && !await page.evaluate(() => !!window.__MT__)) {
      const observed = await capture.find('', page.url());
      return observed ? await convert(observed) : fallback('widget_not_found');
    }
    diagnostics.stage = 'widget_ready';
    await page.waitForFunction(hostList => typeof window.__MT__?.fetchProduct === 'function'
      && hostList.includes(window.__MT__?.scriptHost), hostList, { timeout: remaining() });
    const consent = await page.evaluate(() => window.__MT__?.isCookieConsent?.() === true);
    if (!consent) {
      diagnostics.stage = 'cookie_consent';
      // Scope the action to this widget; never click a storefront's purchase/cart buttons.
      const button = page.locator('.g-shopping-cookie-banner').getByText('Allow Cookies', { exact: true });
      await button.click({ timeout: remaining() });
      await page.waitForFunction(() => window.__MT__?.isCookieConsent?.(), null, { timeout: remaining() });
      diagnostics.stage = 'reload';
      await page.reload({ waitUntil: 'domcontentloaded', timeout: remaining() });
    }
    diagnostics.stage = 'initialize';
    await page.waitForFunction(() => window.__MT__?.cookieConsent && window.__MT__?.cart_id
      && typeof window.__MT__?.fetchProduct === 'function',
    null, { timeout: remaining() });
    diagnostics.stage = 'product_uid';
    const uid = await page.evaluate(hostList => {
      const mt = window.__MT__;
      if (!hostList.includes(mt.scriptHost)) return '';
      if (typeof mt.detectedUIDExtend === 'function') mt.detectedUIDExtend();
      return String(mt.UID || '');
    }, hostList);
    if (!uid) return fallback('product_uid_missing');
    let candidate = await capture.find(uid, page.url());
    if (!candidate) {
      let lastInvocation = 0;
      while (Date.now() < deadline) {
        candidate = await capture.find(uid, page.url());
        if (candidate) break;
        const state = capture.state(uid);
        diagnostics.requestCount = state.count;
        if (state.failure) { diagnostics.stage = 'api_response'; return fallback(state.failure); }
        diagnostics.stage = state.count ? 'api_response' : 'request_dispatch';
        if (!state.count && Date.now() - lastInvocation >= 500 && diagnostics.attempts < 3) {
          // The readiness check and call must occur in the same browser task.
          // A busy widget silently skips fetchProduct(), so retry only while no request was sent.
          const invoked = await page.evaluate(({ expectedUid, hostList }) => {
            const mt = window.__MT__;
            if (!mt || !hostList.includes(mt.scriptHost)
              || String(mt.UID || '') !== expectedUid || mt.isRequestInProgress) return false;
            void Promise.resolve(mt.fetchProduct()).catch(() => {});
            return true;
          }, { expectedUid: uid, hostList });
          if (invoked) { diagnostics.attempts++; lastInvocation = Date.now(); }
        }
        await page.waitForTimeout(Math.min(100, remaining()));
      }
    }
    diagnostics.requestCount = capture.state(uid).count;
    return candidate ? await convert(candidate) : fallback(diagnostics.requestCount ? 'api_response_timeout' : 'product_request_not_sent');
  } catch (error) { return fallback(error.name === 'TimeoutError' ? 'stage_timeout' : 'widget_error'); }
}

/** Convert API data only. Empty fields never trigger DOM enrichment. */
export function normalizeShoppingProduct(candidate, sourceUrl, finalUrl) {
  const p = candidate.products[0];
  const number = value => value !== null && value !== undefined && String(value).trim() !== ''
    && Number.isFinite(Number(value)) ? Number(value) : null;
  const absolute = value => {
    try { const url = new URL(value, finalUrl); return /^https?:$/.test(url.protocol) ? url.href : null; } catch { return null; }
  };
  const normalized = normalizeApiOptions(p.options);
  const groups = normalized.groups;
  const partial = normalized.status === 'partial';
  const price = number(p.sellprice);
  const soldout = !!p.soldout && p.soldout !== 'N' || p.sell_accept === 'N' || p.display === 'N'
    || number(p.quantity) !== null && number(p.quantity) <= 0;
  const additionalProducts = candidate.products.slice(1).filter(isAdditionalProduct).map(item => ({
    ...applyOptionFallback(normalizeShoppingProduct({ ...candidate, products: [item] }, sourceUrl, finalUrl)),
    uid: String(item.uid), required: item.required === 'Y',
  }));
  const additionTitle = p.opt_type === 'addition' ? groups.map(group => group.name).filter(Boolean).join(' / ') : '';
  return { title: additionTitle || p.product_name, price, currency: 'KRW', additionalProducts,
    images: [...new Set([p.maximage, p.minimage, p.tinyimage].filter(Boolean).map(absolute).filter(Boolean))],
    description: '', content: { blocks: [] },
    // Preserve the exact API detail HTML and all stock/basic-option data for callers.
    productContent: typeof p.product_content === 'string' ? p.product_content : '',
    contentAnalysis: { status: p.product_content ? 'provided' : 'none', source: 'global_shopping' },
    optionGroups: groups, optionAnalysis: { status: partial ? 'partial' : groups.length ? 'complete' : 'none', source: 'global_shopping' },
    availability: soldout ? 'OutOfStock' : p.sell_accept === 'Y' ? 'InStock' : '',
    sourceUrl, finalUrl, canonicalUrl: finalUrl, source: 'global_shopping',
    platform: candidate.platform.replace(/^o_/, ''), globalShopping: { products: candidate.products },
    status: price !== null && !partial ? 'complete' : 'needs_review' };
}
