/** 현재 상품에 연결된 구조화 데이터만 정규화한다. 원본 응답/고객정보는 보관하지 않는다. */
export function normalizeOptionData(payloads, identity) {
  const candidates = [];
  const text = (value) => typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, 500) : '';
  const sameUrl = (value) => {
    try { const a = new URL(value, identity.url); const b = new URL(identity.url); return a.origin === b.origin && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, ''); } catch { return false; }
  };
  const matches = (item) => {
    const urls = [item.url, item.permalink].filter(Boolean);
    if (urls.length) return urls.some(sameUrl);
    if (item.handle) return new URL(identity.url).pathname.endsWith('/products/' + item.handle);
    return identity.title && text(item.title || item.name).toLowerCase() === text(identity.title).toLowerCase();
  };
  let visited = 0;
  const walk = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 10 || candidates.length > 40 || visited++ >= 10000) return;
    if (!Array.isArray(node) && matches(node) && (Array.isArray(node.variants) || Array.isArray(node.hasVariant) || Array.isArray(node.variations)
      || Array.isArray(node.optionGroups) || Array.isArray(node.options))) candidates.push(node);
    for (const [key, child] of Object.entries(node).slice(0, 500)) {
      if (!/recommend|related|customer|account|cart|checkout|order/i.test(key)) walk(child, depth + 1);
    }
  };
  for (const payload of payloads) walk(payload);
  const normalized = [];
  for (const product of candidates) {
    const shopify = Array.isArray(product.variants) && product.variants.some((item) => Array.isArray(item.options) || item.option1 !== undefined);
    const woo = Array.isArray(product.variations);
    const rows = shopify ? product.variants : woo ? product.variations : product.hasVariant;
    if (!Array.isArray(rows) || !rows.length) {
      const groups = normalizeNamedOptions(product.optionGroups || product.options);
      if (groups.length) normalized.push({ groups, noOptions: false, source: 'structured' });
      continue;
    }
    if (rows.length > 500) continue;
    const names = shopify ? (product.options || []).map((option) => text(typeof option === 'string' ? option : option.name))
      : woo ? [...new Set(rows.flatMap((row) => Object.keys(row.attributes || {})))]
      : ['color', 'size', 'material', 'pattern'].filter((name) => rows.some((row) => row[name]));
    if (!names.length || names.length > 10 || names.some((name) => !name)) continue;
    const groups = names.map((name, i) => ({ id: `variant-${i}`, name: product.optionLabels?.[name] || name, sourceName: name, type: 'select', required: true, inputType: 'text', values: [], source: shopify ? 'shopify' : woo ? 'woocommerce' : 'schema', priceDelta: null }));
    const combinations = [];
    let valid = true;
    for (const row of rows) {
      const rawValues = shopify ? row.options || names.map((_, i) => row[`option${i + 1}`]) : woo ? names.map((name) => row.attributes?.[name]) : names.map((name) => row[name]);
      if (rawValues.length !== names.length || rawValues.some((value) => !text(value))) { valid = false; break; }
      const offer = Array.isArray(row.offers) ? row.offers[0] : row.offers || {};
      const values = {};
      rawValues.forEach((value, i) => {
        const id = text(value);
        const label = text(product.valueLabels?.[names[i]]?.[id] || value);
        values[groups[i].id] = id;
        if (!groups[i].values.some((choice) => choice.id === id)) groups[i].values.push({ id, label, priceDelta: null, disabled: false });
      });
      // Shopify storefront JSON의 정수 가격은 JPY/KRW도 100으로 나눈다.
      // https://shopify.dev/docs/api/liquid/objects/product#product-price
      const rawPrice = shopify ? row.price : woo ? row.display_price : offer.price;
      const price = rawPrice !== null && rawPrice !== undefined && rawPrice !== '' && Number.isFinite(Number(rawPrice))
        ? Number(rawPrice) / (shopify && typeof rawPrice === 'number' ? 100 : 1) : null;
      const disabled = row.available === false || row.is_in_stock === false || row.variation_is_active === false || /OutOfStock|SoldOut|Discontinued/i.test(offer.availability || '');
      const currencyMatches = shopify || woo ? identity.currency !== 'UNKNOWN' && !!identity.currency : offer.priceCurrency === identity.currency;
      combinations.push({ values, disabled, priceDelta: price !== null && currencyMatches && identity.price !== null ? Number((price - identity.price).toFixed(4)) : null });
    }
    if (!valid || !combinations.length) continue;
    // Shopify의 단일 기본 변형은 사용자 선택 옵션이 아니다.
    const noOptions = shopify && groups.length === 1 && groups[0].name === 'Title' && groups[0].values.length === 1 && groups[0].values[0].label === 'Default Title';
    if (noOptions) { normalized.push({ groups: [], noOptions: true, source: 'shopify' }); continue; }
    for (const group of groups) for (const choice of group.values) choice.disabled = combinations.filter((row) => row.values[group.id] === choice.id).every((row) => row.disabled);
    groups[0].combinationGroupIds = groups.map((group) => group.id);
    groups[0].combinations = combinations;
    groups[0].combinationsComplete = shopify ? rows.every((row) => typeof row.available === 'boolean')
      : woo ? rows.every((row) => typeof row.is_in_stock === 'boolean') : false;
    normalized.push({ groups, noOptions: false, source: groups[0].source });
  }
  return normalized;
}

/** 상품에 귀속된 이름/값 목록은 조합 관계를 추정하지 않고 부분 수집으로 보존한다. */
function normalizeNamedOptions(options) {
  const text = (value) => typeof value === 'object' && value !== null ? String(value.target || value.origin || '') : String(value ?? '');
  return (Array.isArray(options) ? options : []).slice(0, 40).flatMap((option, index) => {
    if (!option || typeof option !== 'object' || !Array.isArray(option.values)) return [];
    const name = text(option.groupName || option.name || option.label).trim().slice(0, 190);
    if (!name || /language|locale|currency|quantity|언어|수량/i.test(name)) return [];
    const values = option.values.slice(0, 200).map((value) => {
      const label = text(typeof value === 'object' && value !== null ? value.name || value.label || value.title || value.value : value).trim().slice(0, 500);
      return { id: String(value?.id ?? value?.value ?? label), label, priceDelta: null,
        disabled: value?.available === false || value?.disabled === true };
    }).filter((value) => value.id && value.label);
    return values.length ? [{ id: `structured-${name}`, name, type: 'select', required: true, inputType: 'text', values, source: 'structured', priceDelta: null }] : [];
  });
}

/** 구조화 상품 옵션과 DOM 입력 옵션을 연결한다. 일치한 그룹만 교체한다. */
export function combineStructuredOptions(domGroups, structured) {
  if (!structured?.groups.length) return domGroups;
  const groups = structuredClone(structured.groups);
  const key = (text) => String(text).trim().toLowerCase();
  for (const incoming of domGroups) {
    const match = incoming.type === 'select' && groups.find((group) => (group.sourceName && group.sourceName === incoming.sourceName) || key(group.name) === key(incoming.name)
      || (incoming.values.length > 0 && incoming.values.every((choice) => group.values.some((other) => key(other.label) === key(choice.label)))));
    if (!match) groups.push(incoming);
  }
  return groups;
}
