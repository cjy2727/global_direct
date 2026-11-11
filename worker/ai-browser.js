import { randomBytes } from 'node:crypto';

/** Executed inside Chromium. IDs refer to observed elements, never model-supplied selectors/code. */
export function readBrowserPage({ prefix, offset = 0 }) {
  const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
  const redact = v => clean(v).replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]').replace(/\b\d{3}[- ]\d{3,4}[- ]\d{4}\b/g, '[phone]');
  const excluded = 'nav,header,footer,[role="dialog"],.reviews,[class*="review" i],[class*="recommend" i],[class*="related" i],[class*="account" i],[class*="customer" i],[class*="shipping" i],[class*="payment" i]';
  const safe = n => !n.closest(excluded);
  const id = n => {
    let v = n.getAttribute('data-gd-ai-id');
    if (!v?.startsWith(prefix)) { v = `${prefix}${offset++}`; n.setAttribute('data-gd-ai-id', v); }
    return v;
  };
  // A stage's own placeholder describes it more precisely than a shared group heading.
  const label = n => {
    const title = clean(n.getAttribute('optiontitle'));
    const rawPlaceholder = clean(n.querySelector('option[value=""]')?.textContent);
    const placeholder = /^(?:[-*\s]+|옵션\s*선택|선택(?:하세요|해\s*주세요|해주십시오)?[.!…]*|choose(?:\s+an?\s+option)?|select(?:\s+an?\s+option)?)$/i.test(rawPlaceholder) ? '' : rawPlaceholder;
    const specificTitle = /\s+\/\s+/.test(title) && placeholder ? placeholder : title;
    return redact(specificTitle || n.getAttribute('data-option-name') || n.getAttribute('aria-label') || n.labels?.[0]?.textContent || placeholder || n.closest('fieldset')?.querySelector('legend')?.textContent || n.closest('.form-group')?.querySelector('label')?.textContent).slice(0, 250);
  };
  const numeric = v => v != null && clean(v) !== '' && Number.isFinite(Number(String(v).replace(/,/g, ''))) ? Number(String(v).replace(/,/g, '')) : null;
  const visible = n => !!n.getClientRects().length && getComputedStyle(n).visibility !== 'hidden';
  const body = document.body.cloneNode(true);
  body.querySelectorAll('script,style,noscript,iframe,input,textarea,[contenteditable],nav,header,footer,[role="dialog"],.reviews,[class*="review" i],[class*="recommend" i],[class*="related" i]').forEach(n => n.remove());
  const controls = [...document.querySelectorAll('select,input:not([type="hidden"]),textarea,[role="listbox"],[role="radiogroup"]')].filter(safe).filter(n => {
    if (n.matches('select,[role="listbox"],[role="radiogroup"]')) return !/quantity|country|currency|language|sort|수량|배송|국가|언어/i.test(label(n) || n.name);
    return n.matches('[optiontype],[data-optiontype],[data-option-name],[name^="option"],[name^="attribute_"]') && !/password|email|tel|search|submit|button|file/i.test(n.type || '');
  }).slice(0, 60).map(n => ({
    id: id(n), kind: n.tagName === 'SELECT' ? 'select' : n.matches('input,textarea') ? 'text' : 'menu', name: label(n),
    sourceId: n.id || '', sourceName: n.getAttribute('name') || '', sourceOptionId: n.getAttribute('opt_id') || '',
    inputType: n.type || '', required: n.required || n.classList.contains('optionRequire') || !!n.closest('.form-group')?.querySelector('label.required,.required'),
    additional: n.classList.contains('optionAdditional'), disabled: !!n.disabled, visible: visible(n),
    priceDelta: numeric(n.getAttribute('price')), optionType: n.getAttribute('optiontype') || n.getAttribute('data-optiontype') || '',
    choices: [...n.querySelectorAll('option,[role="option"],[role="radio"]')].filter(o => o.tagName !== 'OPTION' || o.value !== '').slice(0, 150).map(o => ({
      id: o.tagName === 'OPTION' ? o.value : id(o), label: redact(o.getAttribute('title') || o.getAttribute('aria-label') || o.textContent).slice(0, 300),
      priceDelta: numeric(o.getAttribute('price') ?? o.getAttribute('data-price-delta')), stock: numeric(o.getAttribute('inven')),
      disabled: !!o.disabled || o.getAttribute('aria-disabled') === 'true' || /품절|sold\s*out/i.test(o.textContent),
    })),
  }));
  const actions = [...document.querySelectorAll('button,[role="button"],[role="tab"],summary,[aria-haspopup="listbox"],[role="option"],[role="radio"],a[href^="#"]')].filter(safe).filter(n => {
    if (!visible(n) || n.matches('[type="submit"]') || n.disabled || n.getAttribute('aria-disabled') === 'true') return false;
    const t = clean(`${n.textContent} ${n.getAttribute('aria-label') || ''}`);
    if (/장바구니|구매하기|바로구매|주문|결제|로그인|동의|입력완료|cart|checkout|buy now|order|pay\b|login|submit/i.test(t)) return false;
    return n.matches('summary,[role="tab"],[aria-haspopup="listbox"],[role="option"],[role="radio"]') || /상세|상품정보|옵션|더보기|description|detail|specification|option|show more/i.test(t);
  }).slice(0, 60).map(n => ({ id: id(n), name: redact(n.getAttribute('aria-label') || n.textContent).slice(0, 180), kind: n.getAttribute('role') === 'option' ? 'option' : 'open' }));
  const images = [...document.images].filter(safe).map(n => {
    const raw = n.getAttribute('data-original') || n.getAttribute('data-src') || n.getAttribute('src');
    try {
      const u = new URL(raw, document.baseURI);
      if (!raw || !/^https?:$/.test(u.protocol) || u.username || u.password || /logo|icon|sprite|btn_|loading|spacer/i.test(u.pathname)) return null;
      return { id: id(n), url: u.href, alt: redact(n.alt || n.title).slice(0, 200), width: n.naturalWidth || n.width, height: n.naturalHeight || n.height };
    } catch { return null; }
  }).filter(Boolean).slice(0, 80);
  const regions = [...document.querySelectorAll('[id],[role="tabpanel"],section,article')].filter(safe).filter(n =>
    /detail|description|specification|contentview|prod_detail/i.test(`${n.id} ${n.className}`) || n.getAttribute('role') === 'tabpanel'
  ).filter(n => n.querySelector('img') || clean(n.textContent)).slice(0, 25).map(n => {
    const copy = n.cloneNode(true); copy.querySelectorAll('script,style,input,textarea,iframe,[contenteditable]').forEach(c => c.remove());
    return { id: id(n), text: redact(copy.textContent).slice(0, 8000), imageIds: [...n.querySelectorAll('img')].map(i => i.getAttribute('data-gd-ai-id')).filter(Boolean), visible: visible(n) };
  });
  return { title: redact(document.title), text: redact(body.textContent).slice(0, 30000), controls, actions, images, regions, offset };
}

export class AiBrowser {
  constructor(page, { signal } = {}) {
    this.page = page; this.signal = signal; this.prefix = `gd${randomBytes(5).toString('hex')}-`; this.offset = 0;
    this.observations = []; this.trace = []; this.selected = new Map(); this.started = false;
    this.origin = new URL(page.url()).origin;
  }
  async start() {
    if (this.started) return;
    this.started = true;
    this.abortSignal = this.signal;
    this.abort = () => { void this.page.close().catch(() => {}); };
    this.abortSignal?.addEventListener('abort', this.abort, { once: true });
    if (this.abortSignal?.aborted) this.abort();
    this.guard = async route => {
      const r = route.request(), u = new URL(r.url());
      if (r.isNavigationRequest() || /cart|checkout|order|payment|purchase|wishlist|basket|\/buy(?:\/|\?|$)/i.test(u.pathname + u.search)) return route.abort();
      if (!['GET', 'HEAD'].includes(r.method())) {
        const body = new URLSearchParams(r.postData() || '');
        // A verified read-only option lookup. Other POST endpoints remain blocked.
        if (!(r.method() === 'POST' && u.origin === this.origin && u.pathname === '/view/option' && /^checkoption[123]$/.test(body.get('mode') || '') && [...body.keys()].every(k => ['mode', 'optnum', 'optvalue1', 'optvalue2', 'optvalue3'].includes(k)))) return route.abort();
      }
      return route.fallback();
    };
    this.popup = p => { void p.close().catch(() => {}); };
    this.download = d => { void d.cancel().catch(() => {}); };
    this.page.on('popup', this.popup); this.page.on('download', this.download);
    await this.page.route('**/*', this.guard);
  }
  async read() {
    this.signal?.throwIfAborted();
    await this.start();
    const snapshot = await this.page.evaluate(readBrowserPage, { prefix: this.prefix, offset: this.offset });
    this.offset = snapshot.offset;
    delete snapshot.offset;
    // Each observation records the selected path; unrelated branches are never asserted as combinations.
    snapshot.path = [...this.selected].map(([id, value]) => ({ id, value }));
    this.observations.push(snapshot);
    return snapshot;
  }
  async execute({ action, target = '', value = '' }) {
    this.signal?.throwIfAborted();
    await this.start();
    let result = 'done';
    try {
      if (action === 'read') return await this.read();
      if (action === 'scroll') await this.page.evaluate(direction => window.scrollBy(0, direction === 'up' ? -window.innerHeight : window.innerHeight), value);
      else if (action === 'wait') await this.page.waitForTimeout(500);
      else {
        const last = this.observations.at(-1);
        const item = [...(last?.controls || []), ...(last?.actions || []), ...(last?.regions || [])].find(c => c.id === target);
        if (!item || !target.startsWith(this.prefix)) throw new Error('unknown_target');
        const locator = this.page.locator(`[data-gd-ai-id="${target}"]`);
        if (action === 'inspect') await locator.scrollIntoViewIfNeeded({ timeout: 1200 });
        else if (action === 'select') {
          if (item.kind !== 'select' || item.disabled || !item.choices.some(c => c.id === value && !c.disabled)) throw new Error('invalid_selection');
          await locator.selectOption(value, { timeout: 1200 }); this.selected.set(target, value);
        } else if (action === 'click') {
          if (!(last?.actions || []).some(c => c.id === target)) throw new Error('action_not_allowed');
          await locator.click({ timeout: 1200 });
        } else throw new Error('unknown_action');
      }
      await this.page.waitForTimeout(300);
    } catch (e) { result = ['unknown_target', 'invalid_selection', 'action_not_allowed', 'unknown_action'].includes(e.message) ? e.message : 'action_failed'; }
    this.trace.push({ action, target, result });
    return { result, page: await this.read() };
  }
  async close() {
    if (!this.started) return;
    this.page.off('popup', this.popup); this.page.off('download', this.download);
    this.abortSignal?.removeEventListener('abort', this.abort);
    await this.page.unroute('**/*', this.guard).catch(() => {});
    this.started = false;
  }
}

/** Resolve AI-selected IDs against observations; do not trust AI-generated prices or stock. */
export function mergeBrowserSelection(product, browser, selection) {
  const result = structuredClone(product), rejected = [];
  let accepted = 0;
  const snapshots = browser.observations;
  const controls = new Map();
  for (const snapshot of snapshots) for (const control of snapshot.controls) {
    const prior = controls.get(control.id);
    // Retain observed choices from different branches but never declare their Cartesian product valid.
    const choices = [...(prior?.choices || [])];
    for (const choice of control.choices) if (!choices.some(c => c.id === choice.id && c.label === choice.label)) choices.push(choice);
    controls.set(control.id, { ...control, choices });
  }
  for (const id of (selection.optionIds || []).slice(0, 40)) {
    const c = controls.get(id);
    if (!c || !c.name || !['select', 'text', 'menu'].includes(c.kind)) { rejected.push({ field: 'option', reason: 'unobserved_or_unnamed' }); continue; }
    // Names can repeat across stages. Merge only a proven identity, never a display label.
    const existing = (result.optionGroups || []).find(g => g.browserElementId === c.id || g.id === `ai-${c.id}`
      || (c.sourceId && g.sourceId === c.sourceId && [...controls.values()].filter(item => item.sourceId === c.sourceId).length === 1)
      || (c.sourceName && g.sourceName === c.sourceName && (c.sourceOptionId
        ? g.sourceOptionId === c.sourceOptionId
        : !(c.sourceId && g.sourceId) && [...controls.values()].filter(item => item.sourceName === c.sourceName).length === 1
          && (result.optionGroups || []).filter(item => item.sourceName === c.sourceName).length === 1)));
    const group = { id: existing?.id || `ai-${id}`, name: c.name, type: c.kind === 'text' ? 'text' : 'select', inputType: 'text',
      browserElementId: c.id, sourceId: c.sourceId, sourceName: c.sourceName, sourceOptionId: c.sourceOptionId,
      required: c.required && !c.additional, additional: c.additional, unavailable: c.disabled,
      values: c.kind === 'text' ? [] : c.choices.map(choice => ({ id: choice.id, label: choice.label, priceDelta: choice.priceDelta, disabled: choice.disabled, stock: choice.stock })),
      priceDelta: c.priceDelta, source: 'ai_browser', isCombination: false, combinationsComplete: false,
      observedPaths: snapshots.filter(s => s.controls.some(g => g.id === id)).map(s => s.path),
    };
    if (group.type === 'select' && !group.values.length) { rejected.push({ field: 'option', reason: 'no_observed_choices' }); continue; }
    result.optionGroups ||= [];
    let changed = !existing;
    if (existing) {
      // Existing verified fields take precedence; supplement only missing choices.
      if (existing.type === 'select') for (const choice of group.values) if (!existing.values.some(v => v.label === choice.label)) { existing.values.push(choice); changed = true; }
    } else result.optionGroups.push(group);
    if (!changed) { rejected.push({ field: 'option', reason: 'existing_value_preserved' }); continue; }
    result.optionAnalysis = { ...result.optionAnalysis, status: 'partial', sources: [...new Set([...(result.optionAnalysis?.sources || []), 'ai_browser'])] };
    accepted++;
  }
  const images = new Map(snapshots.flatMap(s => s.images).map(i => [i.id, i]));
  const regions = new Map(snapshots.flatMap(s => s.regions).map(r => [r.id, r]));
  result.content ||= { version: 1, blocks: [] }; result.content.blocks ||= [];
  for (const id of (selection.detailIds || []).slice(0, 40)) {
    const image = images.get(id), region = regions.get(id);
    if (!image && !region) { rejected.push({ field: 'detail', reason: 'unobserved_target' }); continue; }
    const blocks = image ? [{ type: 'image', url: image.url, alt: image.alt }] : [
      ...(region.text ? [{ type: 'text', text: region.text }] : []),
      ...region.imageIds.map(key => images.get(key)).filter(Boolean).map(i => ({ type: 'image', url: i.url, alt: i.alt })),
    ];
    for (const block of blocks) if (!result.content.blocks.some(b => block.type === 'image' ? b.url === block.url : b.text === block.text)) { result.content.blocks.push(block); accepted++; }
  }
  if (result.content.blocks.length) result.content.status = 'extracted';
  if (accepted) result.status = 'needs_review';
  return { product: result, accepted, rejected };
}
