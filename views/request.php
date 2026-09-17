<?php
$currency = $product['currency'] . ' ';
?>
<section class="page-head compact">
    <span class="eyebrow">구매대행 신청</span>
    <h1>배송지를 입력해 주세요</h1>
    <p>
        <?= htmlspecialchars($product['title'], ENT_QUOTES, 'UTF-8') ?>
        · <?= $product['price'] > 0 ? htmlspecialchars($currency, ENT_QUOTES, 'UTF-8') . number_format((float) $product['price'], \App\GlobalCommerce::fractionDigits($product['currency'])) : '상품 금액 확인 중' ?>
    </p>
</section>

<form
    id="request-form"
    class="checkout-grid"
    data-address-requirements="<?= htmlspecialchars(json_encode(\App\GlobalCommerce::ADDRESS_REQUIREMENTS), ENT_QUOTES, 'UTF-8') ?>"
    data-product-id="<?= htmlspecialchars($product['public_id'], ENT_QUOTES, 'UTF-8') ?>">
    <section class="panel-form">
        <h2>상품 선택</h2>
        <label>구매 국가·지역
            <select name="source_country" data-country-select>
                <option value="">모름 · 운영자 확인</option>
                <?php foreach (explode(' ', \App\GlobalCommerce::COUNTRIES) as $code): ?>
                    <option value="<?= $code ?>"><?= $code ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <label>견적 통화
            <select name="quote_currency" required>
                <option value="">통화를 선택해 주세요</option>
                <?php foreach (explode(' ', \App\GlobalCommerce::CURRENCIES) as $code): ?>
                    <option value="<?= $code ?>" <?= $product['currency'] === $code ? 'selected' : '' ?>><?= $code ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <p class="muted">견적 통화는 결제 통화와 별개입니다. 환율·배송비·구매 가능 여부는 접수 후 확인합니다.</p>

        <?php require __DIR__ . '/product-options.php'; ?>

        <label>
            수량
            <input name="quantity" type="number" min="1" max="20" value="1">
        </label>
        <label>
            요청사항
            <textarea name="request_note" rows="3" maxlength="1000"></textarea>
        </label>
    </section>

    <section class="panel-form">
        <h2>배송지</h2>
        <label>배송 국가·지역
            <select name="country_code" data-country-select required>
                <option value="">국가를 선택해 주세요</option>
                <?php foreach (explode(' ', \App\GlobalCommerce::COUNTRIES) as $code): ?>
                    <option value="<?= $code ?>"><?= $code ?></option>
                <?php endforeach; ?>
            </select>
        </label>
        <p class="muted">선택 가능한 국가는 배송 확정 국가가 아닙니다. 해당 경로의 배송 가능 여부를 검토합니다.</p>
        <div class="split">
            <label>받는 분<input name="recipient" required></label>
            <label>우편번호<input name="postal_code" autocomplete="postal-code"></label>
        </div>
        <div class="split">
            <label>주·도·지역<input name="region" autocomplete="address-level1"></label>
            <label>도시<input name="city" autocomplete="address-level2"></label>
        </div>
        <label>상세 주소<input name="address1" required></label>
        <label>나머지 주소<input name="address2"></label>
        <label>연락처 (국가번호 포함)<input name="phone" type="tel" required></label>
    </section>

    <section class="checkout-submit">
        <p>접수 후 상품 재고와 구매 가능 여부를 확인합니다.</p>
        <button class="primary" type="submit">구매대행 신청하기 <span>→</span></button>
        <div class="form-message"></div>
    </section>
</form>
