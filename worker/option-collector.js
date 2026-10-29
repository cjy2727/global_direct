import { extractProductOptions, mergeOptionGroups } from './product-options.js';
import { normalizeOptionData, combineStructuredOptions } from './option-sources.js';

/** 같은 출처의 상품 JSON만 메모리에서 읽는다. 쿠키/헤더/원본 응답은 결과에 포함하지 않는다. */
export function watchOptionResponses(page, rawUrl) {
  const payloads = [];
  const pending = new Set();
  let count = 0;
  let stopped = false;
  const origin = new URL(rawUrl).origin;
  const listener = (response) => {
    const url = new URL(response.url());
    const headers = response.headers();
    if (stopped || count >= 20 || url.origin !== origin || !/product|variant|option|graphql/i.test(url.pathname)
      || /cart|checkout|order|customer|account/i.test(url.pathname) || !/json/i.test(headers['content-type'] || '')
      || Number(headers['content-length'] || 0) > 1024 * 1024) return;
    count++;
    const task = response.text().then((body) => {
      if (!stopped && body.length <= 1024 * 1024) { try { payloads.push(JSON.parse(body)); } catch {} }
    }).catch(() => {}).finally(() => pending.delete(task));
    pending.add(task);
  };
  page.on('response', listener);
  return {
    payloads,
    async finish() {
      await Promise.race([Promise.allSettled([...pending]), new Promise((resolve) => setTimeout(resolve, 500))]);
      stopped = true;
      page.off('response', listener);
    },
  };
}

/** 옵션 DOM이 안정될 때까지 제한된 시간만 기다린다. 빈 옵션은 더 오래 관찰한다. */
export async function waitForOptions(page, { timeout = 4500, minimum = 1500 } = {}) {
  const started = Date.now();
  let last = '';
  let stableSince = started;
  let groups = [];
  while (Date.now() - started < timeout) {
    groups = await page.evaluate(extractProductOptions, {});
    const signature = JSON.stringify(groups);
    if (signature !== last) { last = signature; stableSince = Date.now(); }
    const loading = await page.locator('[aria-busy="true"]').count();
    if (groups.length && groups.every((group) => group.type !== 'select' || (group.values.length && !group.unavailable))
      && !loading && Date.now() - started >= minimum && Date.now() - stableSince >= 700) return groups;
    await page.waitForTimeout(150);
  }
  return groups;
}

/** 기본 select 연동만 제한적으로 탐색한다. 클릭/제출 없이, 선택 중 변경 요청과 이동은 차단한다. */
export async function exploreSelectOptions(page, initial, { budget = 8000, limit = 80 } = {}) {
  const selects = initial.filter((group) => group.control === 'select' && group.required);
  if (selects.length < 2 || selects.length > 5) return { groups: initial, complete: false, explored: false };
  const deadline = Date.now() + budget;
  let groups = initial;
  let visits = 0;
  let complete = true;
  const combinations = [];
  const guard = async (route) => {
    const request = route.request();
    if (!['GET', 'HEAD'].includes(request.method()) || request.isNavigationRequest()
      || /cart|checkout|order|purchase|payment|wishlist|basket|\/buy(?:\/|\?|$)/i.test(new URL(request.url()).pathname + new URL(request.url()).search)) return route.abort();
    return route.fallback();
  };
  await page.route('**/*', guard);
  // Shared optionlist[] names need the platform option ID to identify one control.
  const locate = (group) => group.sourceOptionId
    ? page.locator(`select[name=${JSON.stringify(group.sourceName)}][opt_id=${JSON.stringify(group.sourceOptionId)}]`)
    : group.sourceId ? page.locator(`select[id=${JSON.stringify(group.sourceId)}]`)
    : page.locator(`select[name=${JSON.stringify(group.sourceName)}]`);
  const original = [];
  try {
    for (const group of selects) {
      const locator = locate(group);
      if (await locator.count() !== 1) return { groups, complete: false, explored: false };
      original.push(await locator.inputValue());
    }
    const visit = async (index, values, delta) => {
      if (Date.now() >= deadline || visits >= limit) { complete = false; return; }
      if (index === selects.length) { combinations.push({ values: { ...values }, disabled: false, priceDelta: delta }); return; }
      const current = (await page.evaluate(extractProductOptions, {})).find((group) => group.id === selects[index].id);
      if (!current || current.unavailable || !current.values.length) { complete = false; return; }
      groups = mergeOptionGroups(groups, [current]);
      // 다른 조합에서만 품절인 값은 전역 품절로 고정하지 않는다. 조합 표가 선택을 제한한다.
      const merged = groups.find((group) => group.id === current.id);
      for (const choice of current.values) {
        const target = merged.values.find((item) => item.id === choice.id);
        if (target && !choice.disabled) target.disabled = false;
      }
      for (const choice of current.values.filter((item) => !item.disabled)) {
        if (Date.now() >= deadline || visits++ >= limit) { complete = false; break; }
        try {
          await locate(current).selectOption(choice.id, { timeout: Math.max(1, Math.min(1200, deadline - Date.now())) });
          await waitForOptions(page, { timeout: Math.max(1, Math.min(1400, deadline - Date.now())), minimum: 750 });
          await visit(index + 1, { ...values, [current.id]: choice.id }, delta !== null && choice.priceDelta !== null ? delta + choice.priceDelta : null);
        } catch { complete = false; }
      }
    };
    await visit(0, {}, 0);
  } finally {
    // 응답의 기본 상품 가격/상세정보는 탐색 전에 수집한다. 가능한 경우 원래 선택도 복구한다.
    for (let i = 0; i < original.length; i++) await locate(selects[i]).selectOption(original[i], { timeout: 300 }).catch(() => {});
    await page.unroute('**/*', guard);
  }
  if (combinations.length) {
    const owner = groups.find((group) => group.id === selects[0].id);
    owner.combinationGroupIds = selects.map((group) => group.id);
    owner.combinations = combinations;
    owner.combinationsComplete = complete;
  }
  return { groups, complete, explored: true };
}

/** 여러 근거를 통합하고 수집 범위와 불확실성을 별도로 반환한다. */
/** Open only product option menus; never choose values or permit write requests. */
async function expandNaverOptionMenus(page) {
  if (!/^(brand|smartstore)\.naver\.com$/i.test(new URL(page.url()).hostname)) return;
  const guard = route => {
    const request = route.request();
    return !['GET', 'HEAD'].includes(request.method()) || request.isNavigationRequest()
      || /cart|checkout|order|purchase|payment|wishlist|basket/i.test(new URL(request.url()).pathname)
      ? route.abort() : route.fallback();
  };
  await page.route('**/*', guard);
  try {
    const menus = page.locator('[aria-haspopup="listbox"][data-shp-area="pcs.optselect"], [aria-haspopup="listbox"][data-shp-area="pcs.addedoptselect"]');
    const deadline = Date.now() + 6000;
    for (let i = 0, count = Math.min(await menus.count(), 20); i < count && Date.now() < deadline; i++) {
      const menu = menus.nth(i);
      if (!await menu.isVisible() || await menu.getAttribute('aria-expanded') === 'true' || await menu.getAttribute('aria-disabled') === 'true') continue;
      try { await menu.click({ timeout: Math.max(1, Math.min(1000, deadline - Date.now())) }); await page.waitForTimeout(150); } catch {}
    }
  } finally { await page.unroute('**/*', guard); }
}

export async function collectOptions(page, { sourceHtml, identity, responses }) {
  await expandNaverOptionMenus(page);
  const live = await page.evaluate(extractProductOptions, {});
  const original = sourceHtml ? await page.evaluate(extractProductOptions, { html: sourceHtml }) : [];
  // 원본 HTML은 라이브에서 사라진 필드만 보완한다. 오래된 선택값/재고로 덮어쓰지 않는다.
  let groups = mergeOptionGroups(live, original.filter((item) => !live.some((other) => other.id === item.id)));
  const embedded = await page.evaluate(() => {
    const data = [];
    for (const script of document.querySelectorAll('script[type="application/json"], script[type="application/ld+json"]')) {
      if (script.textContent.length > 1024 * 1024 || data.length >= 25) continue;
      try { data.push(JSON.parse(script.textContent)); } catch {}
    }
    // Next.js 스트리밍 상태도 동일한 상품 식별/정규화 검사를 통과해야 사용한다.
    for (const entry of (window.__next_f || []).slice(0, 50)) {
      const chunk = entry?.[1];
      if (typeof chunk !== 'string' || chunk.length > 1024 * 1024 || !/variant|option/i.test(chunk)) continue;
      for (const line of chunk.split('\n').slice(0, 100)) {
        if (data.length >= 50) break;
        try { data.push(JSON.parse(line.slice(line.indexOf(':') + 1))); } catch {}
      }
    }
    for (const form of document.querySelectorAll('form.variations_form[data-product_variations]')) {
      if (form.closest('[class*="recommend"], [class*="related"]')) continue;
      const raw = form.getAttribute('data-product_variations');
      if (raw.length > 1024 * 1024) continue;
      try {
        const variations = JSON.parse(raw);
        const optionLabels = {}, valueLabels = {};
        for (const select of form.querySelectorAll('select[name^="attribute_"]')) {
          optionLabels[select.name] = select.labels?.[0]?.textContent?.trim() || select.name;
          valueLabels[select.name] = Object.fromEntries([...select.options].map((option) => [option.value, option.textContent.trim()]));
        }
        if (Array.isArray(variations)) data.push({ url: location.href, variations, optionLabels, valueLabels });
      } catch {}
    }
    return data;
  });
  await responses.finish();
  const structured = normalizeOptionData([...embedded, ...responses.payloads], identity);
  // 완전한 조합표를 우선하고, 같은 수준이면 더 많은 변형을 가진 응답을 사용한다.
  structured.sort((a, b) => Number(!!b.groups[0]?.combinationsComplete) - Number(!!a.groups[0]?.combinationsComplete)
    || (b.groups[0]?.combinations?.length || 0) - (a.groups[0]?.combinations?.length || 0));
  const best = structured.find((item) => item.groups.length) || structured[0];
  groups = mergeOptionGroups(groups, ...structured.filter((item) => !item.groups[0]?.combinations).map((item) => item.groups));
  let complete = false;
  if (best?.groups.length) {
    groups = combineStructuredOptions(groups, best);
    complete = best.groups[0].combinationsComplete && groups.every((group) => group.type === 'text' || best.groups.some((item) => item.id === group.id));
  } else {
    // Dependent platform options need more time to traverse each matrix branch.
    const budget = groups.some((group) => group.sourceOptionId) ? 30000 : 8000;
    const explored = await exploreSelectOptions(page, groups, { budget });
    groups = explored.groups;
    // DOM만으로는 숨겨진 필드나 늦은 응답의 부재를 증명할 수 없어 확인 필요로 둔다.
  }
  const noOptions = !groups.length && best?.noOptions === true;
  const status = noOptions ? 'none' : complete ? 'complete' : groups.length ? 'partial' : 'unresolved';
  return { groups, analysis: { status, sources: [...new Set(groups.map((group) => group.source))],
    message: status === 'partial' ? '옵션 일부 또는 조합을 자동으로 확인하지 못했습니다. 원본 상품과 비교해 주세요.'
      : status === 'unresolved' ? '옵션이 없는 상품인지 자동 확인하지 못했습니다. 원본 상품을 확인해 주세요.' : '' } };
}
