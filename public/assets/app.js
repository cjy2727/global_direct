const money = new Intl.NumberFormat('ja-JP');

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

const statusLabels = {
  payment_pending: '決済待ち', paid: '決済済み', local_ordered: '韓国内注文済み',
  warehouse_received: '倉庫到着', inspected: '検品完了', international_shipping: '国際配送中',
  customs: '通関中', domestic_shipping: '日本国内配送', delivered: '配達完了',
  cancelled: 'キャンセル', refund_requested: '返金確認中', refunded: '返金完了', blocked_item: '配送不可'
};

const quoteForm = document.querySelector('#quote-form');
if (quoteForm) {
  quoteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = quoteForm.querySelector('button');
    const result = document.querySelector('#quote-result');
    button.disabled = true;
    button.textContent = '商品を確認中...';
    result.hidden = true;
    try {
      const response = await fetch('/api/quote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: quoteForm.url.value, quantity: quoteForm.quantity.value }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '見積もりに失敗しました。');
      const e = data.estimate;
      result.innerHTML = `<div class="result-head"><span>${escapeHtml(e.mall)}</span><strong>概算 ¥${money.format(e.total_jpy)}</strong></div><dl><div><dt>商品代</dt><dd>¥${money.format(e.product_jpy)}</dd></div><div><dt>韓国内送料・代行費</dt><dd>¥${money.format(e.local_shipping_jpy + e.service_fee_jpy)}</dd></div><div><dt>国際送料</dt><dd>¥${money.format(e.international_shipping_jpy)}</dd></div><div><dt>予想税額</dt><dd>¥${money.format(e.estimated_tax_jpy)}</dd></div></dl><p>確定金額ではありません。担当者が商品情報と配送可否を確認します。</p>`;
      result.hidden = false;
    } catch (error) {
      result.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      result.hidden = false;
    } finally {
      button.disabled = false;
      button.innerHTML = '無料で見積もる <span>→</span>';
    }
  });
}

async function loadOrders() {
  const container = document.querySelector('#orders-table');
  if (!container) return;
  container.innerHTML = '<div class="loading">注文を読み込み中...</div>';
  try {
    const response = await fetch('/api/orders');
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '読み込みに失敗しました。');
    document.querySelector('#open-count').textContent = data.orders.filter((o) => !['delivered', 'cancelled', 'refunded'].includes(o.status)).length;
    container.innerHTML = `<table><thead><tr><th>注文</th><th>顧客</th><th>商品・金額</th><th>状態</th><th>次の処理</th></tr></thead><tbody>${data.orders.map((o) => `<tr><td><strong>${escapeHtml(o.order_no)}</strong><small>${escapeHtml(o.created_at)}</small></td><td>${escapeHtml(o.customer_name)}</td><td><strong>${escapeHtml(o.product_name)}</strong><small>¥${money.format(o.total_jpy)}</small></td><td><span class="status-pill">${escapeHtml(statusLabels[o.status] || o.status)}</span></td><td>${o.next_statuses.length ? `<select class="status-select" data-order="${escapeHtml(o.order_no)}"><option value="">選択...</option>${o.next_statuses.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(statusLabels[s] || s)}</option>`).join('')}</select>` : '—'}</td></tr>`).join('')}</tbody></table>`;
  } catch (error) {
    container.innerHTML = `<div class="error-panel">${escapeHtml(error.message)}</div>`;
  }
}

document.querySelector('#refresh-orders')?.addEventListener('click', loadOrders);
document.querySelector('#orders-table')?.addEventListener('change', async (event) => {
  if (!event.target.matches('.status-select') || !event.target.value) return;
  const select = event.target;
  select.disabled = true;
  try {
    const response = await fetch(`/api/orders/${encodeURIComponent(select.dataset.order)}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': window.APP.csrf }, body: JSON.stringify({ status: select.value }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || '状態変更に失敗しました。');
    await loadOrders();
  } catch (error) {
    alert(error.message);
    select.disabled = false;
  }
});

if (document.querySelector('#orders-table')) loadOrders();
