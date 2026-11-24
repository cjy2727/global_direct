import { assertPublicUrl } from './public-url.js';

// Local Linux diagnostic only: attach to the existing browser, never launch/login.
const target = await assertPublicUrl(process.argv[2]);
if (!['smartstore.naver.com', 'brand.naver.com'].includes(target.hostname)) {
    throw new Error('This diagnostic accepts Naver product URLs only.');
}
const productId = target.pathname.match(/\/products\/(\d+)\/?$/)?.[1];
if (!productId) throw new Error('A product detail URL is required.');
const documentAccept = process.argv.includes('--document-accept');
const mobile = process.argv.includes('--mobile');
const accept = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/jxl,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7';
const loginCookies = new Set(['NID_AUT', 'NID_SES']);
const safeUrl = raw => { try { const u = new URL(raw); return u.origin + u.pathname; } catch { return '[invalid URL]'; } };

async function connect(url) {
    const socket = new WebSocket(url);
    const pending = new Map();
    const listeners = new Set();
    let sequence = 0;
    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data);
        if (message.id) {
            const item = pending.get(message.id);
            if (!item) return;
            pending.delete(message.id);
            clearTimeout(item.timer);
            if (message.error) item.reject(new Error('CDP command failed'));
            else item.resolve(message.result);
        } else for (const listener of listeners) listener(message);
    });
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP connection timeout')), 8000);
        socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
        socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connection failed')); }, { once: true });
    });
    socket.addEventListener('close', () => {
        for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error('CDP disconnected')); }
        pending.clear();
    });
    return {
        on(listener) { listeners.add(listener); },
        send(method, params = {}) {
            return new Promise((resolve, reject) => {
                const id = ++sequence;
                const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timeout`)); }, 10000);
                pending.set(id, { resolve, reject, timer });
                socket.send(JSON.stringify({ id, method, params }));
            });
        },
        close() { socket.close(); },
    };
}

const endpoint = 'http://127.0.0.1:9222';
let browser, page, targetId;
try {
    const version = await fetch(`${endpoint}/json/version`).then(r => r.json());
    browser = await connect(version.webSocketDebuggerUrl);
    ({ targetId } = await browser.send('Target.createTarget', { url: 'about:blank', background: true }));
    const tabs = await fetch(`${endpoint}/json/list`).then(r => r.json());
    page = await connect(tabs.find(tab => tab.id === targetId).webSocketDebuggerUrl);
    const cookies = (await page.send('Network.getCookies', { urls: [target.href, 'https://nid.naver.com/'] })).cookies;
    if (cookies.some(cookie => loginCookies.has(cookie.name))) throw new Error('Login cookies present; anonymous diagnostic stopped.');

    const documents = [], requests = [], blocks = [], snapshots = [];
    const documentIds = new Set();
    let authenticationBlocked = false;
    const work = new Set();
    const guard = async request => {
        try {
            await assertPublicUrl(request.request.url);
            const headers = Object.entries(request.request.headers);
            const cookie = headers.find(([name]) => name.toLowerCase() === 'cookie')?.[1] || '';
            if (/(?:^|;\s*)NID_(?:AUT|SES)=/.test(cookie)) {
                authenticationBlocked = true;
                throw new Error('Authentication blocked');
            }
            if (!['GET', 'HEAD'].includes(request.request.method)) throw new Error('Read-only requests only');
            const override = documentAccept && request.resourceType === 'Document' && safeUrl(request.request.url) === safeUrl(target.href);
            const params = { requestId: request.requestId };
            if (override) params.headers = [...headers.filter(([name]) => name.toLowerCase() !== 'accept').map(([name, value]) => ({ name, value: String(value) })), { name: 'Accept', value: accept }];
            await page.send('Fetch.continueRequest', params);
        } catch {
            blocks.push({ url: safeUrl(request.request.url), method: request.request.method });
            await page.send('Fetch.failRequest', { requestId: request.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        }
    };
    page.on(message => {
        const p = message.params;
        if (message.method === 'Fetch.requestPaused') {
            const promise = guard(p).finally(() => work.delete(promise));
            work.add(promise);
        }
        if (message.method === 'Network.requestWillBeSent' && p.type === 'Document') documentIds.add(p.requestId);
        if (message.method === 'Network.requestWillBeSent' && p.type === 'Document' && p.redirectResponse) {
            documents.push({ url: safeUrl(p.redirectResponse.url), status: p.redirectResponse.status, redirectTo: safeUrl(p.request.url) });
        }
        if (message.method === 'Network.responseReceived' && p.type === 'Document') {
            documents.push({ url: safeUrl(p.response.url), status: p.response.status, diskCache: !!p.response.fromDiskCache, serviceWorker: !!p.response.fromServiceWorker });
        }
        if (message.method === 'Network.requestWillBeSentExtraInfo') {
            const h = Object.fromEntries(Object.entries(p.headers).map(([name, value]) => [name.toLowerCase(), value]));
            // Never retain or print Cookie/Authorization values.
            requests.push({ requestId: p.requestId, cacheControl: h['cache-control'] ?? null, pragma: h.pragma ?? null });
        }
    });
    await page.send('Page.enable');
    await page.send('Network.enable');
    if (mobile) {
        await page.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
        await page.send('Emulation.setTouchEmulationEnabled', { enabled: true });
    }
    await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
    // Interception remains active for URL/method checks. Explicitly restore caching.
    await page.send('Network.setCacheDisabled', { cacheDisabled: false });
    await page.send('Page.navigate', { url: target.href });
    const expression = `(() => {
        const s = window.__PRELOADED_STATE__ || {};
        const p = [s.product, s.simpleProductForDetailPage].find(x => x?.name && String(x.id) === ${JSON.stringify(productId)});
        const text = document.body?.innerText || '';
        const normalize = x => (x || '').replace(/\\s+/g, ' ').trim();
        const heading = [...document.querySelectorAll('h1,h2,h3')].some(el => p && normalize(el.innerText) === normalize(p.name));
        const price = p && Number(p.salePrice);
        const priceText = price > 0 && (text.includes(price.toLocaleString('en-US')) || new RegExp('(^|[^0-9])' + price + '([^0-9]|$)').test(text));
        return { url: location.origin + location.pathname, title: document.title,
            product: p ? { id: p.id, name: p.name, salePrice: p.salePrice } : null,
            productNameVisible: heading, priceVisible: !!priceText,
            login: !!document.querySelector('input[type=password]'),
            unavailable: /상품이 존재하지 않습니다|현재 서비스 접속이 불가합니다/.test(text),
            challenge: /보안 확인|보안 인증|자동입력 방지|security verification|verify that you are a real user/i.test(text) };
    })()`;
    for (const delay of [1000, 3000, 8000]) {
        await new Promise(resolve => setTimeout(resolve, delay));
        const result = await page.send('Runtime.evaluate', { expression, returnByValue: true });
        if (!result.result.value) throw new Error('Page observation failed');
        snapshots.push(result.result.value);
    }
    const last = snapshots.at(-1);
    const sameProductUrl = last.url === safeUrl(target.href);
    const ok = !authenticationBlocked && sameProductUrl && last.productNameVisible && last.priceVisible && !last.login && !last.unavailable && !last.challenge;
    console.log(JSON.stringify({ ok, status: ok ? 'detail_visible' : last.product ? 'needs_review' : 'access_failed', mode: 'persistent_linux_anonymous', cacheEnabled: true, documentAccept, mobile, documents, requests: requests.filter(request => documentIds.has(request.requestId)), blocks, snapshots }, null, 2));
    if (!ok) process.exitCode = 2;
    await Promise.allSettled([...work]);
} catch (error) {
    // Avoid dumping protocol objects, headers, or page contents on failures.
    console.error(JSON.stringify({ ok: false, message: error.message }));
    process.exitCode = 1;
} finally {
    page?.close();
    if (browser && targetId) await browser.send('Target.closeTarget', { targetId }).catch(() => {});
    browser?.close();
}
