/** Convert the production API's option definitions and stock rows together. */
export function normalizeApiOptions(options) {
  const number = value => value != null && String(value).trim() !== '' && Number.isFinite(Number(value)) ? Number(value) : null;
  const definitions = Array.isArray(options?.option) ? options.option : [];
  let partial = !Array.isArray(options?.option);
  const groups = definitions.filter(option => option.opt_use === 'Y' && option.opt_type !== 'HIDDEN').map((option, index) => {
    const text = ['CUSTOM', 'TEL', 'TEXT', 'EMAIL'].includes(option.opt_type);
    const prices = String(option.opt_price ?? '').split(',');
    const mixed = !text && option.opt_type !== 'ADDITION' && option.opt_mix === 'Y';
    const values = text ? [] : String(option.opt_value ?? '').split(',').map((label, i) => ({
      id: String(i), label: label.trim(), priceDelta: mixed ? null : number(prices[i]), disabled: false,
    })).filter(value => value.label);
    return { id: `option-${option.opt_id ?? index}`, sourceOptionId: String(option.opt_id ?? index), name: option.opt_name || '',
      type: text ? 'text' : 'select', required: option.opt_mandatory === 'Y', values,
      inputType: option.opt_type === 'TEL' ? 'tel' : option.opt_type === 'EMAIL' ? 'email' : 'text',
      isCombination: mixed, isAdditional: option.opt_type === 'ADDITION', source: 'global_shopping' };
  });
  const split = value => String(value ?? '').split(',').map(value => value.trim());
  const rowDisabled = row => row.sto_state_code !== 'SALE' || (row.sto_unlimit !== 'Y' && row.sto_stop_use !== 'N'
    && number(row.sto_real_stock) !== null && number(row.sto_real_stock) <= 0);
  const mixed = groups.filter(group => group.isCombination);
  if (mixed.length) {
    const expected = mixed.reduce((count, group) => count * group.values.length, 1);
    const combinations = [];
    const seen = new Set();
    let valid = expected > 0 && expected <= 10000 && Array.isArray(options?.basic);
    for (const row of (Array.isArray(options?.basic) ? options.basic : []).slice(0, 10001)) {
      if (row.sto_type && row.sto_type !== 'BASIC') continue;
      const ids = split(row.opt_ids), labels = split(row.sto_opt_values);
      const values = {};
      let mapped = ids.length === mixed.length && labels.length === ids.length && new Set(ids).size === ids.length;
      for (const group of mixed) {
        const index = ids.indexOf(group.sourceOptionId);
        const matches = group.values.filter(value => value.label === labels[index]);
        if (index < 0 || matches.length !== 1) { mapped = false; break; }
        values[group.id] = matches[0].id;
      }
      const priceDelta = number(row.sto_price);
      if (!mapped || priceDelta === null || typeof row.sto_state_code !== 'string' || !row.sto_state_code) { valid = false; continue; }
      const key = mixed.map(group => values[group.id]).join(':');
      if (seen.has(key)) { valid = false; continue; }
      seen.add(key);
      combinations.push({ id: String(row.sto_id ?? key), values, priceDelta, disabled: rowDisabled(row), state: row.sto_state_code });
    }
    valid &&= combinations.length === expected;
    if (valid) {
      mixed[0].combinationGroupIds = mixed.map(group => group.id);
      mixed[0].combinations = combinations;
      mixed[0].combinationsComplete = true;
      for (const group of mixed) for (const value of group.values) {
        value.disabled = !combinations.some(row => !row.disabled && row.values[group.id] === value.id);
      }
    } else partial = true;
  }
  for (const group of groups) {
    if (group.type === 'select' && !group.values.length) partial = true;
    if (!group.isAdditional) continue;
    const rows = (Array.isArray(options?.addition) ? options.addition : []).filter(row => split(row.opt_ids).includes(group.sourceOptionId));
    const rowByLabel = new Map();
    let valid = Array.isArray(options?.addition);
    for (const row of rows) {
      const ids = split(row.opt_ids), labels = split(row.sto_opt_values);
      const label = labels[ids.indexOf(group.sourceOptionId)];
      if (ids.length !== 1 || labels.length !== 1 || !group.values.some(value => value.label === label)
        || rowByLabel.has(label) || number(row.sto_price) === null || !row.sto_state_code) { valid = false; continue; }
      rowByLabel.set(label, row);
    }
    for (const value of group.values) {
      const row = rowByLabel.get(value.label);
      if (!row) { valid = false; value.priceDelta = null; value.unresolved = true; continue; }
      value.priceDelta = number(row.sto_price);
      value.disabled = rowDisabled(row);
      value.stockId = String(row.sto_id ?? '');
    }
    if (!valid) partial = true;
    group.hasUnresolvedValues = group.values.some(value => value.unresolved);
  }
  return { groups, status: partial ? 'partial' : groups.length ? 'complete' : 'none' };
}
