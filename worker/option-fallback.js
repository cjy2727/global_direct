/** Text fields are a separate definition so partial selects are not silently treated as complete. */
export function applyOptionFallback(product, evidence = { controls: [] }) {
  const status = product.optionAnalysis?.status || 'unresolved';
  if (['complete', 'none'].includes(status)) return { ...product, optionFallback: { status: 'not_needed', fields: [] } };
  const names = [...new Set([
    ...(product.optionGroups || []).map(g => g.name),
    ...(evidence.controls || []).flatMap(c => String(c.name || '').split(/\s+\/\s+/)),
  ].filter(n => typeof n === 'string' && n.trim() && !/quantity|currency|country|language|sort|수량|배송|결제|국가|언어/i.test(n)))].slice(0, 20);
  const known = names.length || (product.optionGroups || []).length || (evidence.controls || []).length;
  const fields = (names.length ? names : [known ? '옵션 직접 입력' : '옵션·요청사항']).map((name, i) => ({
    id: `manual-option-${i}`, name, type: 'text', required: false, values: [], source: 'manual_fallback',
    replacesGroupIds: (product.optionGroups || []).filter(g => g.name === name).map(g => g.id),
    placeholder: '원본 상품을 확인하고 옵션을 입력해 주세요.', priceDelta: null,
  }));
  return { ...product, status: 'needs_review', optionFallback: {
    status: 'manual_input', reason: status, fields, priceConfirmed: false, stockConfirmed: false,
    message: '옵션·추가금·재고를 자동 확인하지 못했습니다. 원본 상품과 비교해 주세요.',
  } };
}
