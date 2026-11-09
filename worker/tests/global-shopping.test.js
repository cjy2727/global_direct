import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { chromium } from 'playwright';
import { watchShoppingResponses, readShoppingProduct, normalizeShoppingProduct } from '../global-shopping.js';

const url = 'https://shop.example.test/item';
const product = { uid: '123', product_name: 'Fixture API product', sellprice: '46000', sell_accept: 'Y',
  maximage: '/image.jpg', product_content: '', options: { option: [], basic: [{ sto_unlimit: 'Y' }] } };
const candidate = { products: [product], uid: '123', platform: 'makeshop' };
const normalized = normalizeShoppingProduct(candidate, url, url);
assert.equal(normalized.status, 'complete');
assert.equal(normalized.contentAnalysis.status, 'none');
assert.equal(normalized.price, 46000);
assert.deepEqual(normalized.globalShopping.products, [product]);
assert.equal(normalizeShoppingProduct({ ...candidate, products: [{ ...product, options: { option: [{ opt_id: '1', opt_use: 'Y', opt_type: 'SELECT', opt_mix: 'Y', opt_value: 'red,blue' }] } }] }, url, url).optionAnalysis.status, 'partial');

// Reject wrong endpoints, development hosts, malformed results and mismatched UID.
const emitter = new EventEmitter();
const capture = watchShoppingResponses(emitter);
const emit = (host, uid, responseUid, status = 'success') => emitter.emit('response', {
  url: () => `https://${host}/global_shopping/api.php?a=product&uid=${uid}&page=${encodeURIComponent(url)}`,
  ok: () => true, json: async () => ({ status, data: [{ ...product, uid: responseUid }] }),
});
emit('app.jycha.shiptao.kr', '123', '123');
emit('app2.malltail.com', '123', '999');
emit('app2.malltail.com', '123', '123', 'error');
assert.equal(await capture.find('123', url), null);
emit('app2.malltail.com', '123', '123');
assert.equal((await capture.find('123', url)).uid, '123');
capture.dispose();
assert.equal(emitter.listenerCount('response'), 0);

const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ['success', 'detail', 'additions', 'addition-error', 'busy-race', 'skipped-call', 'always-busy', 'error', 'absent']) {
    const context = await browser.newContext({ locale: 'en-US' });
    const page = await context.newPage();
    let apiCalls = 0;
    await page.route('**/*', async route => {
      const requestUrl = new URL(route.request().url());
      if (requestUrl.hostname === 'shop.example.test') return route.fulfill({ contentType: 'text/html', body: `<p>DOM POISON PRICE 999999</p>${mode === 'absent' ? '' : '<script src="https://app2.malltail.com/global_shopping/js/script-min.js"></script>'}` });
      if (requestUrl.pathname.endsWith('script-min.js')) return route.fulfill({ contentType: 'application/javascript', body: `
        const consent = sessionStorage.getItem('consent') === 'yes';
        window.__MT__ = { scriptHost:'app2.malltail.com', cookieConsent:consent, cart_id:consent?'fixture-cart':'',
          UID:'123', isRequestInProgress:false, isCookieConsent:()=>sessionStorage.getItem('consent')==='yes',
          detectedUIDExtend(){ if(${JSON.stringify(mode)}==='busy-race')queueMicrotask(()=>{this.isRequestInProgress=true;setTimeout(()=>this.isRequestInProgress=false,200);});
            if(${JSON.stringify(mode)}==='always-busy')this.isRequestInProgress=true; },
          fetchProduct(){ if(this.isRequestInProgress)return; if(${JSON.stringify(mode)}==='skipped-call'&&!this.skipped){this.skipped=true;return;}
            return fetch('https://app2.malltail.com/global_shopping/api.php?a=product&uid=123&_=makeshop&page='+encodeURIComponent(location.href)).then(r=>r.json());},
          fetchProductAddition(){if(this.isRequestInProgress)return; if(!this.pifo?.[0])throw new Error('Current productInfo missing');return fetch('https://app2.malltail.com/global_shopping/api.php?a=product.addition&uid=123&_=makeshop&page='+encodeURIComponent(location.href)).then(r=>r.json());} };
        if(!consent){const banner=document.createElement('div');banner.className='g-shopping-cookie-banner';
        banner.innerHTML='<button>Allow Cookies</button>';banner.onclick=()=>sessionStorage.setItem('consent','yes');document.body.append(banner);}
      ` });
      if (requestUrl.pathname.endsWith('api.php')) {
        apiCalls++;
        assert.equal(requestUrl.hostname, 'app2.malltail.com');
        if (requestUrl.searchParams.get('a') === 'product.addition') return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({status:mode==='addition-error'?'error':'success',data:[product,
            { ...product, uid:'456', opt_type:'add', required:'N', product_name:'Fixture gift wrap', sellprice:'2000', options:{option:[{opt_id:'wrap',opt_use:'Y',opt_type:'SELECT',opt_name:'Wrap color',opt_value:'red,blue',opt_mandatory:'Y'}]} },
            { ...product, uid:'789', opt_type:'add', required:'N', product_name:'Fixture bag', sellprice:'12000' }]}) });
        return route.fulfill({ contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ status: ['success', 'detail', 'additions', 'addition-error', 'busy-race', 'skipped-call'].includes(mode) ? 'success' : 'error', data: [{ ...product,
            add_composition: ['additions','addition-error'].includes(mode)?[{uid:'456'},{uid:'789'}]:[],
            product_content: mode === 'detail' ? '<p>API detail only</p><img src="/detail.jpg"><script>DOM POISON</script>' : '' }] }) });
      }
      throw new Error(`Unexpected fixture request: ${requestUrl.origin}`);
    });
    const watcher = watchShoppingResponses(page);
    await page.goto(url);
    const diagnostics = {};
    const result = await readShoppingProduct(page, watcher, url, { timeout: 1800, diagnostics });
    if (['success', 'detail', 'additions', 'addition-error', 'busy-race', 'skipped-call'].includes(mode)) {
      assert.equal(result.title, product.product_name);
      assert.equal(result.description, mode === 'detail' ? 'API detail only' : '');
      if (mode === 'detail') assert.deepEqual(result.content.blocks, [{ type: 'text', text: 'API detail only' }, { type: 'image', url: 'https://shop.example.test/detail.jpg' }]);
      else assert.deepEqual(result.content.blocks, []);
      assert.equal(result.status, mode==='addition-error'?'needs_review':'complete');
      assert.equal(apiCalls, ['additions','addition-error'].includes(mode)?2:1);
      assert.equal(result.shoppingAnalysis.requestCount, 1);
      if(mode==='additions') {
        assert.equal(result.additionalProducts.length,2);
        assert.equal(result.additionalProducts[0].price,2000);
        assert.equal(result.additionalProducts[0].required,false);
        assert.equal(result.additionalProducts[0].optionGroups[0].values.length,2);
        assert.equal(result.globalShopping.products.length,3);
        assert.equal(result.additionAnalysis.status,'complete');
      } else if(mode==='addition-error') {
        assert.equal(result.title,product.product_name);
        assert.equal(result.additionalProducts.length,0);
        assert.equal(result.additionAnalysis.status,'partial');
        assert.equal(result.additionAnalysis.reason,'api_error');
      }
      if (mode === 'skipped-call') assert.equal(result.shoppingAnalysis.attempts, 2);
    } else {
      assert.equal(result, null);
      assert.equal(apiCalls, mode === 'error' ? 1 : 0);
      assert.equal(diagnostics.status, 'fallback');
      assert.equal(diagnostics.reason, mode === 'error' ? 'api_error' : mode === 'always-busy' ? 'product_request_not_sent' : 'widget_not_found');
    }
    watcher.dispose();
    await context.close();
  }
  console.log('PASS: browser API capture, consent/reload, exact UID, production hosts, no DOM enrichment, failure/absent fallback (synthetic fixtures).');
} finally { await browser.close(); }
