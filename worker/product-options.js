/** 브라우저에서 상품 옵션 정의만 읽으며 고객 입력값은 반환하지 않는다. */
export function extractProductOptions({ html = null } = {}) {
  const root = html === null ? document : new DOMParser().parseFromString(html, 'text/html');
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 500);
  const scope = '[data-product-options], .product-options, .product-form, product-form, variant-selects, variant-radios, .variations, form[action*="/cart/add"], form[name="form1"], [itemtype$="/Product"], [data-product-id], .product-detail, .product-info, .item-detail, #product, #goods_view, main, [role="main"]';
  const excluded = 'nav, header, footer, .reviews, .recommendations, [class*="recommend"], [class*="related"], [data-product-recommendations]';
  const explicit = '[name="optionlist[]"][opt_id]';
  const groups = [];
  const seen = new Map();
  const isRakuten = /(^|\.)rakuten\.co\.jp$/i.test(location.hostname);
  const number = (value) => value !== null && String(value).trim() !== '' && Number.isFinite(Number(String(value).replace(/,/g, ''))) ? Number(String(value).replace(/,/g, '')) : null;
  const labelText = (label) => {
    if (!label) return '';
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select, input, textarea, button').forEach((node) => node.remove());
    return clean(copy.textContent);
  };
  const nameOf = (control) => clean(control.getAttribute('label') || labelText(control.labels?.[0])
    || control.getAttribute('aria-label') || root.getElementById?.(control.getAttribute('aria-labelledby'))?.textContent
    || control.closest('fieldset')?.querySelector('legend')?.textContent
    || control.closest('dl')?.querySelector('dt')?.textContent
    || control.closest('tr')?.querySelector('th, .label')?.textContent || control.name);
  const eligible = (control) => !control.closest(excluded) && (control.matches(explicit)
    || control.closest(scope) || control.matches('select[itemprop="color"], select[itemprop="size"]')
    || /^(?:options?\[|attribute_|radioGroup-|color$|colour$|size$)/i.test(control.name || control.id || ''));
  const add = (control, type, sourceId, name, choices = []) => {
    if (!name || /(?:language|locale|currency|quantity|country|sort|payment|shipping|언어|수량|배송|결제)/i.test(name)) return;
    const id = `option-${sourceId || name}`;
    const previous = seen.get(id);
    if (previous) {
      for (const choice of choices) if (!previous.values.some((item) => item.id === choice.id)) previous.values.push(choice);
      return;
    }
    if (groups.length >= 40) return;
    const group = { id, name, type, required: control.required || control.getAttribute('require') === 'Y'
      || control.getAttribute('opt_mandatory') === 'Y' || type === 'select',
      inputType: /e-?mail|이메일/i.test(name) ? 'email' : /phone|연락처|전화/i.test(name) ? 'tel' : 'text',
      placeholder: type === 'text' ? clean(control.getAttribute('placeholder') || control.getAttribute('title')) : '',
      values: choices, priceDelta: type === 'text' ? number(control.getAttribute('price')) : null,
      source: 'dom', control: control.tagName === 'SELECT' ? 'select' : control.type === 'radio' ? 'radio' : type,
      sourceId: clean(control.id), sourceName: clean(control.name), unavailable: !!control.disabled };
    if (control.matches(explicit)) group.required = control.required || control.getAttribute('require') === 'Y' || control.getAttribute('opt_mandatory') === 'Y';
    groups.push(group);
    seen.set(id, group);
  };
  for (const control of root.querySelectorAll('select, input[type="radio"], input[name="optionlist[]"][opt_id]')) {
    if (!eligible(control) || control.type === 'hidden') continue;
    // Shopify 상품 폼의 id 필드는 색상/크기가 아니라 최종 변형 ID이다.
    if (control.matches('select[name="id"]') && control.closest('form[action*="/cart/add"], product-form')) continue;
    const name = nameOf(control);
    const sourceId = clean(control.getAttribute('opt_id') || (control.type === 'radio' ? control.name : control.id || control.name) || name);
    if (control.tagName === 'SELECT') {
      const values = [...control.options].filter((option) => option.value !== '' && !/^(?:\*+|[-–]+|옵션\s*선택|선택해|choose\b|select\b|選択)/i.test(clean(option.textContent))).slice(0, 200).map((option) => ({
        id: String(option.value), label: clean(option.textContent),
        priceDelta: number(option.getAttribute('data-price-delta') ?? option.getAttribute('price')),
        disabled: option.disabled || /품절|sold\s*out|out of stock|売り切れ|在庫なし/i.test(option.textContent),
      }));
      add(control, 'select', sourceId, name, values);
    } else if (control.type === 'radio') {
      const rawName = clean(control.closest('fieldset')?.querySelector('legend')?.textContent || control.getAttribute('data-option-name') || control.name);
      const groupName = isRakuten && /^radioGroup-/i.test(rawName) ? '구매 방식' : rawName;
      const rawLabel = clean(control.labels?.[0]?.textContent || control.getAttribute('aria-label') || control.value);
      const label = isRakuten ? ({ normal: '일반 구매', subscription: '정기 구매' }[rawLabel.toLowerCase()] || rawLabel) : rawLabel;
      add(control, 'select', sourceId, groupName, [{ id: control.value, label,
        priceDelta: number(control.getAttribute('data-price-delta')), disabled: control.disabled }]);
    } else if (['text', 'email', 'tel'].includes(control.type) && !control.disabled) {
      add(control, 'text', sourceId, name);
    }
  }
  // 명시적인 역할/옵션 속성이 있는 커스텀 버튼과 이미지 선택 UI를 읽는다.
  for (const container of root.querySelectorAll('[role="radiogroup"], [role="listbox"], [data-option-name]')) {
    if (!eligible(container) || container.querySelector('select, input[type="radio"]')) continue;
    const name = clean(container.getAttribute('data-option-name') || container.getAttribute('aria-label') || nameOf(container));
    const choices = [...container.querySelectorAll('[role="radio"], [role="option"], button[data-value], [data-option-value]')].slice(0, 200).map((item) => ({
      id: clean(item.getAttribute('data-option-value') || item.getAttribute('data-value') || item.getAttribute('value') || item.getAttribute('aria-label') || item.textContent),
      label: clean(item.getAttribute('aria-label') || item.textContent || item.querySelector('img')?.alt),
      priceDelta: number(item.getAttribute('data-price-delta')),
      disabled: item.matches(':disabled, [aria-disabled="true"], [data-available="false"]') || /품절|sold\s*out/i.test(item.textContent),
    })).filter((item) => item.id && item.label);
    if (choices.length) add(container, 'select', clean(container.id || name), name, choices);
  }
  return groups;
}

/** 같은 ID 또는 이름/선택값을 통합한다. 먼저 받은 라이브 DOM의 상태를 우선한다. */
export function mergeOptionGroups(...sources) {
  const result = [];
  const key = (value) => String(value).trim().toLowerCase().replace(/\s+/g, ' ');
  for (const groups of sources) for (const incoming of groups || []) {
    const group = structuredClone(incoming);
    const existing = result.find((item) => item.id === group.id || (item.type === group.type && key(item.name) === key(group.name)
      && (item.type === 'text' || !item.values.length || !group.values.length || item.values.some((a) => group.values.some((b) => key(a.label) === key(b.label))))));
    if (!existing) { if (result.length < 40) result.push(group); continue; }
    for (const choice of group.values || []) {
      const found = existing.values.find((item) => item.id === choice.id || key(item.label) === key(choice.label));
      if (!found && existing.values.length < 200) existing.values.push(choice);
      else if (found && found.priceDelta === null && choice.priceDelta !== null) found.priceDelta = choice.priceDelta;
    }
  }
  return result;
}
