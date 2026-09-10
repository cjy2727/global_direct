<?php
$currency = [
    'KRW' => '₩',
    'JPY' => '¥',
    'USD' => '$',
][$product['currency']] ?? $product['currency'] . ' ';
?>
<section class="page-head compact">
    <span class="eyebrow">구매대행 신청</span>
    <h1>배송지를 입력해 주세요</h1>
    <p>
        <?= htmlspecialchars($product['title'], ENT_QUOTES, 'UTF-8') ?>
        · <?= htmlspecialchars($currency, ENT_QUOTES, 'UTF-8') ?><?= number_format((float) $product['price']) ?>
    </p>
</section>

<form
    id="request-form"
    class="checkout-grid"
    data-product-id="<?= htmlspecialchars($product['public_id'], ENT_QUOTES, 'UTF-8') ?>">
    <section class="panel-form">
        <h2>상품 선택</h2>

        <?php foreach ($product['options'] as $index => $option): ?>
            <label>
                <?= htmlspecialchars($option['name'], ENT_QUOTES, 'UTF-8') ?>
                <select
                    name="option_<?= $index ?>"
                    data-option-name="<?= htmlspecialchars($option['name'], ENT_QUOTES, 'UTF-8') ?>"
                    required>
                    <option value="">선택해 주세요</option>
                    <?php foreach ($option['values'] as $value): ?>
                        <option value="<?= htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8') ?>">
                            <?= htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8') ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </label>
        <?php endforeach; ?>

        <?php if (!$product['options']): ?>
            <label>
                옵션 직접 입력
                <input
                    name="manual_option"
                    data-option-name="직접 입력 옵션"
                    placeholder="색상, 크기 등 원하는 옵션">
            </label>
        <?php endif; ?>

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
        <div class="split">
            <label>받는 분<input name="recipient" required></label>
            <label>우편번호<input name="postal_code" required></label>
        </div>
        <div class="split">
            <label>시·도<input name="region" required></label>
            <label>시·군·구<input name="city" required></label>
        </div>
        <label>상세 주소<input name="address1" required></label>
        <label>나머지 주소<input name="address2"></label>
        <label>연락처<input name="phone" required></label>
    </section>

    <section class="checkout-submit">
        <p>접수 후 상품 재고와 구매 가능 여부를 확인합니다.</p>
        <button class="primary" type="submit">구매대행 신청하기 <span>→</span></button>
        <div class="form-message"></div>
    </section>
</form>