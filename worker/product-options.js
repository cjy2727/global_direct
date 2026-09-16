/** 상품 옵션만 읽는다. 고객 입력값은 수집하지 않으며 입력형/선택형 메타데이터를 분리한다. */
export function extractProductOptions({ html = null } = {}) {
  const root = html === null ? document : new DOMParser().parseFromString(html, 'text/html');
  const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
  const explicit = [...root.querySelectorAll('[name="optionlist[]"][opt_id]')];
  const controls = explicit.length ? explicit : [...root.querySelectorAll(
    '[data-product-options] select, .product-options select, form[name="form1"] select, select[itemprop="color"], select[itemprop="size"]',
  )];
  const groups = [];
  const seen = new Set();
  for (const control of controls) {
    if (groups.length >= 40 || control.type === 'hidden' || control.disabled) continue;
    if (control.closest('nav, .reviews, .recommendations, [hidden]')) continue;
    const name = clean(control.getAttribute('label') || control.labels?.[0]?.textContent
      || control.getAttribute('aria-label') || control.closest('dl')?.querySelector('dt')?.textContent || control.name);
    if (!name || /language|locale|언어/i.test(name)) continue;
    const sourceId = clean(control.getAttribute('opt_id') || control.id || control.name);
    const id = `option-${sourceId || groups.length}`;
    if (seen.has(id)) continue;
    const type = control.tagName === 'SELECT' ? 'select' : 'text';
    if (type === 'text' && !['text', 'email', 'tel'].includes(control.type)) continue;
    const required = control.required || control.getAttribute('require') === 'Y' || control.getAttribute('opt_mandatory') === 'Y';
    const inputType = /e-?mail|이메일/i.test(name) ? 'email' : /phone|연락처|전화/i.test(name) ? 'tel' : 'text';
    const group = { id, name, type, required, inputType,
      placeholder: type === 'text' ? clean(control.getAttribute('placeholder') || control.getAttribute('title')).slice(0, 200) : '',
      values: [], priceDelta: type === 'text' && control.hasAttribute('price') ? Number(control.getAttribute('price')) : null };
    if (type === 'select') {
      for (const option of control.options) {
        if (option.value === '' || group.values.length >= 100) continue;
        const label = clean(option.textContent);
        if (!label || (/^(?:옵션\s*선택|선택해|choose|select)/i.test(label) && option.disabled)) continue;
        const rawPrice = option.getAttribute('price');
        const delta = rawPrice !== null && rawPrice.trim() !== '' ? Number(rawPrice.replace(/,/g, '')) : null;
        group.values.push({ id: String(option.value), label,
          priceDelta: Number.isFinite(delta) ? delta : null,
          disabled: option.disabled || /품절|sold\s*out|out of stock/i.test(label) });
      }
      if (!group.values.length) continue;
    }
    groups.push(group);
    seen.add(id);
  }
  return groups;
}
