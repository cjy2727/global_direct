export function makeshopFixture() {
  const option = [
    { opt_id: '44', opt_type: 'SELECT', opt_name: 'Color', opt_value: 'Red,Blue', opt_price: '0,0', opt_use: 'Y', opt_mix: 'Y', opt_mandatory: 'Y' },
    { opt_id: '31', opt_type: 'SELECT', opt_name: 'Size', opt_value: 'Small,Large', opt_price: '0,0', opt_use: 'Y', opt_mix: 'Y', opt_mandatory: 'Y' },
    { opt_id: '29', opt_type: 'SELECT', opt_name: 'Set', opt_value: 'Single,Pillow set', opt_price: '0,0', opt_use: 'Y', opt_mix: 'Y', opt_mandatory: 'Y' },
  ];
  const basic = [];
  for (const color of ['Red', 'Blue']) for (const size of ['Small', 'Large']) for (const set of ['Single', 'Pillow set']) {
    basic.push({ sto_id: String(basic.length), opt_ids: '44,31,29', sto_type: 'BASIC', sto_opt_values: `${color},${size},${set}`,
      sto_price: String((size === 'Large' ? 10000 : 0) + (set === 'Pillow set' ? 14000 : 0)),
      sto_unlimit: 'Y', sto_real_stock: '1000', sto_stop_use: 'Y', sto_state_code: color === 'Red' && size === 'Large' && set === 'Single' ? 'HIDE' : 'SALE' });
  }
  const main = { uid: '123', product_name: 'Fixture bedding', sellprice: '59900', sell_accept: 'Y', quantity: 'Unlimited', options: { option, basic } };
  const additions = Array.from({ length: 6 }, (_, index) => ({ uid: `123-${46 + index}`, opt_type: 'addition', required: 'N',
    product_name: main.product_name, sellprice: 0, sell_accept: 'Y', quantity: 'Unlimited', options: {
      option: [{ opt_id: String(46 + index), opt_type: 'ADDITION', opt_name: `Extra ${index + 1}`, opt_use: 'Y', opt_mix: 'Y',
        opt_mandatory: 'N', opt_value: 'White,Black', opt_price: '34900,44900' }], basic: [],
      addition: ['White', 'Black'].map((label, i) => ({ sto_id: `${index}-${i}`, opt_ids: String(46 + index), sto_type: 'ADDITION', sto_opt_values: label,
        sto_price: String(i ? 44900 : 34900), sto_unlimit: 'Y', sto_stop_use: 'N', sto_state_code: i ? 'HIDE' : 'SALE' })),
    } }));
  return { uid: '123', platform: 'makeshop', products: [main, ...additions] };
}
