import { assertPublicUrl } from './public-url.js';
import { extractProductContent } from './product-content.js';
import { collectOptions, waitForOptions, watchOptionResponses } from './option-collector.js';
import { watchShoppingResponses, readShoppingProduct } from './global-shopping.js';
import { collectEvidence } from './ai.js';
import { normalizeNaverProductData } from './option-sources.js';
import { applyOptionFallback } from './option-fallback.js';
import { AiBrowser } from './ai-browser.js';
import { ServiceError } from './jobs.js';
import { collectProductEvidence, validateProductData } from './product-availability.js';

export function watchNaverAccess(page, rawUrl) {
    const source = new URL(rawUrl);
    const id = source.pathname.match(/\/products\/(\d+)\/?$/)?.[1];
    const enabled = ['brand.naver.com', 'smartstore.naver.com'].includes(source.hostname) && Boolean(id);
    let deniedStatus = null;
    const onResponse = response => {
        if (!enabled || ![403, 429, 490].includes(response.status())) return;
        try {
            const url = new URL(response.url());
            const request = response.request();
            const document = request.isNavigationRequest() && request.frame() === page.mainFrame()
                && url.origin === source.origin && url.pathname === source.pathname;
            const match = url.pathname.match(/^\/i\/v2\/channels\/[^/]+\/products\/(\d+)\/?$/);
            const detail = ['xhr', 'fetch'].includes(request.resourceType())
                && ['m.smartstore.naver.com', 'smartstore.naver.com'].includes(url.hostname) && match?.[1] === id;
            if (document || detail) {
                // Keep a verification requirement even if another request is later denied.
                if (deniedStatus !== 490) deniedStatus = response.status();
            }
        } catch { /* Ignore malformed response URLs. */ }
    };
    if (enabled) page.on('response', onResponse);
    return {
        check() {
            if (!enabled) return;
            let login = false;
            try { const url = new URL(page.url()); login = url.hostname === 'nid.naver.com' && url.pathname === '/nidlogin.login'; } catch { }
            if (deniedStatus === 490) throw new ServiceError('store_verification_required', '네이버가 보안 인증을 요구하여 상품 정보를 수집하지 못했습니다.', 422);
            if (login) throw new ServiceError('store_login_required', '네이버가 상품 요청을 로그인 페이지로 이동시켜 비로그인 상태에서 상품 정보를 수집하지 못했습니다.', 422);
            if (deniedStatus) throw new ServiceError('store_access_denied', '판매처에서 상품 페이지 접근을 제한했습니다. 잠시 후 다시 시도해 주세요.', 422);
        },
        dispose() { if (enabled) page.off('response', onResponse); }
    };
}
function parsePrice(value) {
    if (value == null) return null;
    const cleaned = String(value).replace(/[^0-9.,]/g, '').replace(/,/g, '');
    const number = Number.parseFloat(cleaned);
    // Preserve source precision before applying the quote currency's rounding rules.
    return Number.isFinite(number) && number > 0 ? Number(number.toFixed(4)) : null;
}

export function createAnalyzer({ chromium, ai }) {
    return async function analyze(rawUrl, signal, config) {
        const jobAi = ai.withConfig(config);
        await assertPublicUrl(rawUrl);
        signal?.throwIfAborted();
        const sourceHost = new URL(rawUrl).hostname.toLowerCase();
        const isNaver = ['brand.naver.com', 'smartstore.naver.com'].includes(sourceHost);
        const browser = await chromium.launch({ headless: !isNaver });
        const cancel = () => { void browser.close().catch(() => { }); };
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) { await browser.close(); signal.throwIfAborted(); }
        try {
            const context = await browser.newContext({ locale: 'en-US', extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' } });
            const page = await context.newPage();
            const naverAccess = watchNaverAccess(page, rawUrl);
            const optionResponses = watchOptionResponses(page, rawUrl);
            const shoppingResponses = watchShoppingResponses(page);
            page.setDefaultTimeout(8000);
            await page.route('**/*', async (route) => {
                try {
                    const requestUrl = new URL(route.request().url());
                    if (!['http:', 'https:'].includes(requestUrl.protocol)) return route.abort('blockedbyclient');
                    if (requestUrl.hostname.endsWith('.shiptao.kr') && requestUrl.pathname.startsWith('/global_shopping/')) return route.abort('blockedbyclient');
                    await assertPublicUrl(requestUrl.href);
                    if (['font', 'media'].includes(route.request().resourceType())) return route.abort('blockedbyclient');
                    return route.continue();
                } catch { return route.abort('blockedbyclient'); }
            });

            try {
                const response = await page.goto(rawUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
                if ([403, 429].includes(response?.status())) throw new ServiceError('store_access_denied', '판매처에서 상품 페이지 접근을 제한했습니다. 잠시 후 다시 시도해 주세요.', 422);
                if (!response || response.status() >= 400) throw new Error(`상품 페이지 응답 오류 (${response?.status() || '응답 없음'})`);
                if (['www.coupang.com', 'coupang.com'].includes(new URL(rawUrl).hostname)) {
                    // The first document can be a loading/check document. Wait for the real
                    // product or an explicit denial; iframe errors do not decide this state.
                    await page.waitForFunction(() => document.title === 'Access Denied' || [...document.querySelectorAll('script[type="application/ld+json"]')].some(node => {
                        try { const item = JSON.parse(node.textContent); return item?.['@type'] === 'Product'; } catch { return false; }
                    }), null, { timeout: 15000 }).catch(() => { });
                    if (await page.title() === 'Access Denied') throw new ServiceError('store_access_denied', '판매처에서 상품 페이지 접근을 제한했습니다. 잠시 후 다시 시도해 주세요.', 422);
                }
                const shoppingAnalysis = {};
                const shoppingProduct = await readShoppingProduct(page, shoppingResponses, rawUrl, { diagnostics: shoppingAnalysis });
                if (shoppingProduct) return applyOptionFallback(validateProductData({ ...shoppingProduct, aiAnalysis: { status: 'skipped', reason: config.aiEnabled ? 'internal_api' : 'disabled' } }, { identified: true }));
                if (!isNaver) naverAccess.check();
                console.warn(JSON.stringify({ event: 'shopping_api_fallback', ...shoppingAnalysis }));
                // 이동 전에 응답을 읽되, 본문을 읽지 못해도 현재 DOM 분석은 계속한다.
                const sourceHtml = await response.text().catch(() => null);
                await waitForOptions(page);
                if (isNaver) {
                    const productId = new URL(rawUrl).pathname.match(/\/products\/(\d+)\/?$/)?.[1];
                    const captured = normalizeNaverProductData(await optionResponses.wait(), productId);
                    if (captured && captured.title && captured.price !== null) {
                        return applyOptionFallback(validateProductData({
                            ...captured, content: { blocks: [], status: 'unavailable' },
                            optionGroups: captured.optionGroups, optionAnalysis: captured.optionAnalysis,
                            sourceUrl: rawUrl, finalUrl: page.url(), canonicalUrl: page.url(), shoppingAnalysis,
                            status: captured.optionGroups.length && captured.optionAnalysis.status !== 'complete' ? 'needs_review' : 'complete',
                            aiAnalysis: { status: 'skipped', reason: config.aiEnabled ? 'internal_api' : 'disabled' }
                        }, { identified: true }));
                    }
                }
                naverAccess.check();
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
                        } catch { }
                    }
                    // 추천 상품이 먼저 선언된 페이지에서는 현재 URL/제목과 일치하는 상품을 우선한다.
                    const currentUrl = document.querySelector('link[rel="canonical"]')?.href || location.href;
                    const heading = text(document.querySelector('h1')?.textContent).toLowerCase();
                    const productScore = (item) => {
                        let score = 0;
                        const productId = location.pathname.match(/^\/vp\/products\/(\d+)/)?.[1];
                        const itemId = new URL(location.href).searchParams.get('itemId');
                        if (['www.coupang.com', 'coupang.com'].includes(location.hostname) && productId && itemId && String(item.sku) === `${productId}-${itemId}`) score += 20;
                        for (const candidate of [item.url, item['@id'], item.mainEntityOfPage?.['@id']]) {
                            if (typeof candidate !== 'string' || !candidate.trim()) continue;
                            try {
                                const url = new URL(candidate, location.href);
                                const current = new URL(currentUrl);
                                if (url.origin === current.origin && url.pathname === current.pathname
                                    && [...url.searchParams].every(([key, value]) => current.searchParams.get(key) === value)) score += 10;
                            } catch { }
                        }
                        if (heading && text(item.name).toLowerCase() === heading) score += 5;
                        return score;
                    };
                    const ranked = products.sort((a, b) => productScore(b) - productScore(a));
                    let product = ranked.find(item => productScore(item) > 0) || {};
                    const pageHost = location.hostname.toLowerCase();
                    if (['brand.naver.com', 'smartstore.naver.com'].includes(pageHost)) {
                        const productId = location.pathname.match(/\/products\/(\d+)\/?$/)?.[1];
                        const state = window.__PRELOADED_STATE__ || window.__INITIAL_STATE__;
                        // Naver may render its simple detail state before the full product state.
                        // Read only this product's public fields, never serialize the whole state.
                        const current = [state?.product, state?.simpleProductForDetailPage]
                            .find(item => productId && String(item?.id) === productId && text(item?.name));
                        if (current) {
                            const salePrice = current.benefitsView?.discountedSalePrice ?? current.discountedSalePrice ?? current.salePrice;
                            product = {
                                '@type': 'Product', name: current.name, url: location.href,
                                image: current.representativeImageUrl ? [current.representativeImageUrl, ...(current.optionalImageUrls || [])]
                                    : (current.productImages || []).map(item => item.url),
                                offers: { price: salePrice, priceCurrency: 'KRW' }
                            };
                        }
                    }
                    const offer = Array.isArray(product.offers) ? product.offers[0] : (product.offers || {});
                    const meta = (selector) => document.querySelector(selector)?.getAttribute('content') || '';
                    const hostname = location.hostname.toLowerCase();
                    const isBlogpay = hostname.endsWith('.shop.blogpay.co.kr');
                    const isRakuten = hostname === 'rakuten.co.jp' || hostname.endsWith('.rakuten.co.jp');
                    const explicitTitle = text(product.name) || text(meta('meta[property="og:title"]')) || text(document.querySelector('h1')?.textContent);
                    const title = explicitTitle || text(document.title);
                    const priceValues = [
                        isBlogpay ? document.querySelector('#goodPrice')?.value : null,
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
                        titleAnalysis: { source: explicitTitle ? 'product_metadata' : 'document_title' },
                        price,
                        currency,
                        structuredProduct: product,
                        description: text(product.description) || text(meta('meta[property="og:description"]')),
                        canonicalUrl: document.querySelector('link[rel="canonical"]')?.href || location.href,
                        availability: text(offer.availability),
                    };
                });
                const content = await page.evaluate(extractProductContent, { product: result.structuredProduct });
                const structuredProduct = result.structuredProduct;
                delete result.structuredProduct;
                const price = parsePrice(result.price);
                const currency = String(result.currency || 'UNKNOWN').trim().toUpperCase();
                const options = await collectOptions(page, { sourceHtml, responses: optionResponses, identity: { url: page.url(), title: result.title, price, currency } });
                naverAccess.check();
                const productEvidence = await page.evaluate(collectProductEvidence, {
                    structuredProduct, sourceUrl: rawUrl,
                    collectedProduct: { ...result, ...content, price, optionGroups: options.groups }
                });
                const product = validateProductData({
                    ...result, ...content, shoppingAnalysis, optionGroups: options.groups, optionAnalysis: options.analysis,
                    price, currency, sourceUrl: rawUrl, finalUrl: page.url(),
                    status: result.title && price && ['complete', 'none'].includes(options.analysis.status) ? 'complete' : 'needs_review'
                }, productEvidence);
                const evidence = await page.evaluate(collectEvidence);
                // Keep public DOM option names even when the generic option collector cannot interpret a control.
                const enriched = await jobAi.browse(product, new AiBrowser(page, { signal }), signal);
                naverAccess.check();
                return applyOptionFallback(validateProductData(enriched, productEvidence), evidence);
            } finally {
                naverAccess.dispose();
                shoppingResponses.dispose();
                await optionResponses.finish();
                await context.close();
            }
        } finally { signal?.removeEventListener('abort', cancel); await browser.close(); }
    };
}
