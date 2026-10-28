const money = new Intl.NumberFormat('ko-KR');

// 긴 상세 이미지는 미리보기로 제공하며 이미지 로딩 후에도 펼친 상태를 유지한다.
const descriptionBody = document.querySelector('#product-description-body');
const descriptionToggle = document.querySelector('.product-description-toggle');
if (descriptionBody && descriptionToggle) {
  let descriptionExpanded = false;
  const updateDescriptionPreview = () => {
    const limit = parseFloat(getComputedStyle(descriptionBody).getPropertyValue('--preview-height'));
    const overflowing = descriptionBody.scrollHeight > limit + 2;
    descriptionBody.classList.toggle('is-collapsed', overflowing && !descriptionExpanded);
    descriptionToggle.hidden = !overflowing;
    descriptionToggle.setAttribute('aria-expanded', String(descriptionExpanded));
    descriptionToggle.textContent = descriptionExpanded ? '상세설명 접기 ↑' : '상세설명 전체보기 ↓';
  };
  descriptionToggle.addEventListener('click', () => {
    descriptionExpanded = !descriptionExpanded;
    updateDescriptionPreview();
    if (!descriptionExpanded) document.querySelector('#product-description').scrollIntoView({ block: 'start' });
  });
  descriptionBody.querySelectorAll('img').forEach((image) => image.addEventListener('load', updateDescriptionPreview));
  window.addEventListener('resize', updateDescriptionPreview);
  updateDescriptionPreview();
}

// 국가명은 화면 언어로 표시하고 서버에는 국가 코드만 전달한다.
document.querySelectorAll('[data-country-select]').forEach((select) => {
  if (typeof Intl.DisplayNames !== 'function') return;
  const names = new Intl.DisplayNames([document.documentElement.lang || 'ko'], { type: 'region' });
  Array.from(select.options).filter((option) => option.value).forEach((option) => {
    option.textContent = `${names.of(option.value)} (${option.value})`;
  });
});

function formatAmount(amount, currency) {
  return new Intl.NumberFormat(document.documentElement.lang || 'ko', {
    style: 'currency', currency, currencyDisplay: 'code',
  }).format(amount);
}

const statusLabels = {
  review_pending: '신청 검토 중',
  confirmed: '상품 확인 완료',
  local_ordered: '현지 주문 완료',
  warehouse_received: '창고 입고',
  inspected: '검수 완료',
  international_shipping: '국제배송 중',
  customs: '통관 중',
  domestic_shipping: '국내 배송 중',
  delivered: '배송 완료',
  cancelled: '취소',
  blocked_item: '배송 불가',
};

function escapeHtml(value) {
  const entities = { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' };
  return String(value ?? '').replace(/[&<>'"]/g, (char) => entities[char]);
}

function selectedOptions(form) {
  const result = {};
  form.querySelectorAll('[data-option-name]').forEach((field) => {
    if (field.value) result[field.dataset.optionId || field.dataset.optionName] = field.value;
  });
  return result;
}

// 선행 옵션에 맞는 확인된 조합만 노출한다. 네이티브 select와 서버 검증을 함께 유지한다.
function syncOptionCombinations(form) {
  for (const script of form.querySelectorAll('[data-option-combinations]')) {
    let matrix;
    try { matrix = JSON.parse(script.textContent); } catch { continue; }
    const selected = {};
    for (const id of matrix.ids) {
      const field = [...form.querySelectorAll('select[data-option-id]')].find((item) => item.dataset.optionId === id);
      if (!field) continue;
      for (const option of field.options) {
        if (!option.value) continue;
        option.disabled = option.dataset.sourceDisabled === '1' || !matrix.rows.some((row) => !row.disabled
          && row.values[id] === option.value && Object.entries(selected).every(([key, value]) => row.values[key] === value));
      }
      if (field.selectedOptions[0]?.disabled) field.value = '';
      if (field.value) selected[id] = field.value;
      field.__mtSync?.();
    }
  }
}
document.querySelectorAll('form').forEach((form) => {
  if (!form.querySelector('[data-option-combinations]')) return;
  form.addEventListener('change', (event) => {
    if (event.target.matches('[data-option-id]')) syncOptionCombinations(form);
  });
  syncOptionCombinations(form);
});

const analyzeForm = document.querySelector('#analyze-form');
if (analyzeForm) {
  analyzeForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = analyzeForm.querySelector('button');
    const result = document.querySelector('#analyze-result');
    button.disabled = true;
    button.textContent = '상품 페이지를 분석하고 있습니다...';
    result.hidden = true;

    try {
      const response = await fetch('/api/products/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: analyzeForm.url.value }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || '상품 페이지를 분석하지 못했습니다.');

      result.innerHTML = '<p>상품 정보를 찾았습니다. 상세 페이지로 이동합니다.</p>';
      result.hidden = false;
      location.href = data.product.url;
    } catch (error) {
      result.innerHTML = `<p class="error">${escapeHtml(error.message)}</p>`;
      result.hidden = false;
      button.disabled = false;
      button.innerHTML = '상품 정보 가져오기 <span>→</span>';
    }
  });

  // 외부 검색 화면에서 전달한 URL로 기존 상품 분석을 시작한다.
  const incomingUrl = new URLSearchParams(window.location.search).get('url');

  if (incomingUrl) {
    try {
      const productUrl = new URL(incomingUrl);

      if (['http:', 'https:'].includes(productUrl.protocol)) {
        analyzeForm.elements.namedItem('url').value = incomingUrl;
        analyzeForm.requestSubmit();
      }
    } catch {
      // 올바르지 않은 URL은 자동 분석하지 않고 입력 화면을 유지한다.
    }
  }
}

document.querySelectorAll('.thumbnail').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelector('#main-product-image').src = button.dataset.image;
    document.querySelectorAll('.thumbnail').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
  });
});

const productForm = document.querySelector('#product-action-form');
if (productForm) {
  const productId = document.querySelector('.product-detail').dataset.productId;
  const message = document.querySelector('#product-action-message');

  document.querySelector('#add-cart-button').addEventListener('click', async () => {
    if (!productForm.reportValidity()) return;

    const response = await fetch('/api/cart/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        product_id: productId,
        quantity: productForm.quantity.value,
        selected_options: selectedOptions(productForm),
        request_note: productForm.request_note.value,
      }),
    });
    const data = await response.json();
    message.textContent = data.ok
      ? `장바구니에 담았습니다. 현재 ${data.cart.count}개 상품이 있습니다.`
      : data.message;
    message.className = `form-message ${data.ok ? 'success' : 'error'}`;
  });

  document.querySelector('#buy-now-button').addEventListener('click', () => {
    if (!productForm.reportValidity()) return;

    sessionStorage.setItem(
      `globaldirect:${productId}`,
      JSON.stringify({
        quantity: productForm.quantity.value,
        selected_options: selectedOptions(productForm),
        request_note: productForm.request_note.value,
      }),
    );
    location.href = `/request?product=${encodeURIComponent(productId)}`;
  });
}

async function loadCart() {
  const container = document.querySelector('#cart-list');
  if (!container) return;

  const data = await fetch('/api/cart').then((response) => response.json());
  if (!data.items.length) {
    container.innerHTML = '<div class="cart-empty">장바구니가 비어 있습니다.</div>';
    return;
  }

  container.innerHTML = data.items.map((item, index) => {
    const image = item.image_url
      ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.title)}" referrerpolicy="no-referrer">`
      : '<div></div>';
    const options = Object.entries(item.option_labels || item.selected_options)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' / ') || '선택 옵션 없음';
    const note = item.request_note ? ` · 요청사항: ${escapeHtml(item.request_note)}` : '';

    return `
      <article class="cart-item">
        ${image}
        <div>
          <h2>${escapeHtml(item.title)}</h2>
          <p>${escapeHtml(options)}</p>
          <p>수량 ${item.quantity}${note}</p>
        </div>
        <a class="primary link-button" data-cart-index="${index}" href="/request?product=${encodeURIComponent(item.public_id)}">구매하기</a>
      </article>
    `;
  }).join('');
  container.querySelectorAll('[data-cart-index]').forEach((link) => {
    link.addEventListener('click', () => {
      const item = data.items[Number(link.dataset.cartIndex)];
      sessionStorage.setItem(`globaldirect:${item.public_id}`, JSON.stringify(item));
    });
  });
}

if (document.querySelector('#cart-list')) loadCart();

async function refreshAccount() {
  const summary = document.querySelector('#account-summary');
  if (!summary) return;

  const session = await fetch('/api/session').then((response) => response.json());
  document.querySelector('#register-form').hidden = Boolean(session.user);
  document.querySelector('#login-form').hidden = Boolean(session.user);
  summary.hidden = !session.user;
  if (!session.user) return;

  document.querySelector('#account-name').textContent = `${session.user.name} (${session.user.email})`;
  const result = await fetch('/api/orders/mine').then((response) => response.json());
  document.querySelector('#my-orders').innerHTML = result.orders.length
    ? result.orders.map((order) => {
      const quote = order.commerce?.quote;
      const total = quote
        ? (quote.product_subtotal === null ? '상품 금액 확인 중'
          : `상품 소계 ${escapeHtml(formatAmount(quote.product_subtotal, quote.quote_currency))}`)
          + ' · 배송비·수수료·세금 및 총액 확인 중'
        : (order.total_jpy > 0 ? `기존 주문 예상 JPY ${money.format(order.total_jpy)}` : '금액 확인 중');
      return `<div class="mini-order"><strong>${escapeHtml(order.order_no)}</strong><span>${escapeHtml(statusLabels[order.status] || order.status)} · ${total}</span></div>`;
    }).join('')
    : '<p class="muted">아직 접수된 주문이 없습니다.</p>';
}

async function submitAuth(form, endpoint) {
  const message = form.querySelector('.form-message');
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(Object.fromEntries(new FormData(form))),
  });
  const data = await response.json();
  message.textContent = data.ok ? '정상적으로 처리되었습니다.' : data.message;
  message.className = `form-message ${data.ok ? 'success' : 'error'}`;
  if (data.ok) await refreshAccount();
}

document.querySelector('#register-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth(event.currentTarget, '/api/register');
});

document.querySelector('#login-form')?.addEventListener('submit', (event) => {
  event.preventDefault();
  submitAuth(event.currentTarget, '/api/login');
});

document.querySelector('#logout-button')?.addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  await refreshAccount();
});

if (document.querySelector('#account-summary')) refreshAccount();

const requestForm = document.querySelector('#request-form');
if (requestForm) {
  const productId = requestForm.dataset.productId;
  const addressRequirements = JSON.parse(requestForm.dataset.addressRequirements);
  const updateAddressRequirements = () => {
    const country = requestForm.country_code.value;
    Object.entries(addressRequirements).forEach(([field, countries]) => {
      requestForm.elements[field].required = countries.includes(country);
    });
  };
  requestForm.country_code.addEventListener('change', updateAddressRequirements);
  updateAddressRequirements();

  try {
    const saved = JSON.parse(sessionStorage.getItem(`globaldirect:${productId}`) || 'null');
    if (saved) {
      requestForm.quantity.value = saved.quantity || 1;
      requestForm.request_note.value = saved.request_note || '';
      requestForm.querySelectorAll('[data-option-name]').forEach((field) => {
        field.value = saved.selected_options?.[field.dataset.optionId || field.dataset.optionName]
          ?? (field.dataset.optionId?.startsWith('legacy-') ? saved.selected_options?.[field.dataset.optionName] : '') ?? '';
      });
    }
  } catch {
    // Ignore invalid session storage and keep the form defaults.
  }
  syncOptionCombinations(requestForm);

  requestForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const raw = Object.fromEntries(new FormData(requestForm));
    const body = {
      product_id: productId,
      source_country: raw.source_country,
      quote_currency: raw.quote_currency,
      quantity: raw.quantity,
      request_note: raw.request_note,
      selected_options: selectedOptions(requestForm),
      address: {
        country_code: raw.country_code,
        recipient: raw.recipient,
        postal_code: raw.postal_code,
        region: raw.region,
        city: raw.city,
        address1: raw.address1,
        address2: raw.address2,
        phone: raw.phone,
      },
    };
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    const message = requestForm.querySelector('.form-message');
    message.innerHTML = data.ok
      ? `신청이 접수되었습니다. <strong>${escapeHtml(data.order.order_no)}</strong>`
      : `${escapeHtml(data.message)}${response.status === 401 ? ' <a href="/account">로그인하기</a>' : ''}`;
    message.className = `form-message ${data.ok ? 'success' : 'error'}`;

    if (data.ok) {
      sessionStorage.removeItem(`globaldirect:${productId}`);
      requestForm.reset();
      updateAddressRequirements();
    }
  });
}
