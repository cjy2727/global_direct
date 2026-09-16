<?php
$images = $product['images'] ?? [];
$options = $product['options'] ?? [];
$detailBlocks = $product['detail_blocks'] ?? [];
$currency = $product['currency'] . ' ';
$sourceHost = strtolower((string) $product['source_host']);
$isCoupang = $sourceHost === 'coupang.com' || str_ends_with($sourceHost, '.coupang.com');
?>
<section
    class="product-detail"
    data-product-id="<?= htmlspecialchars($product['public_id'], ENT_QUOTES, 'UTF-8') ?>">
    <div class="product-gallery">
        <div class="product-main-image">
            <?php if ($images): ?>
                <img
                    id="main-product-image"
                    src="<?= htmlspecialchars($images[0], ENT_QUOTES, 'UTF-8') ?>"
                    alt="<?= htmlspecialchars($product['title'], ENT_QUOTES, 'UTF-8') ?>"
                    referrerpolicy="no-referrer">
            <?php else: ?>
                <div class="image-empty">상품 이미지를 찾지 못했습니다</div>
            <?php endif; ?>
        </div>

        <?php if (count($images) > 1): ?>
            <div class="product-thumbnails">
                <?php foreach ($images as $index => $image): ?>
                    <button
                        type="button"
                        class="thumbnail<?= $index === 0 ? ' active' : '' ?>"
                        data-image="<?= htmlspecialchars($image, ENT_QUOTES, 'UTF-8') ?>">
                        <img
                            src="<?= htmlspecialchars($image, ENT_QUOTES, 'UTF-8') ?>"
                            alt="상품 이미지 <?= $index + 1 ?>"
                            loading="lazy"
                            referrerpolicy="no-referrer">
                    </button>
                <?php endforeach; ?>
            </div>
        <?php endif; ?>
    </div>

    <div class="product-info">
        <a
            class="source-host"
            href="<?= htmlspecialchars($product['final_url'], ENT_QUOTES, 'UTF-8') ?>"
            target="_blank"
            rel="noopener noreferrer">
            원본 사이트 · <?= htmlspecialchars($product['source_host'], ENT_QUOTES, 'UTF-8') ?> ↗
        </a>

        <h1><?= htmlspecialchars($product['title'], ENT_QUOTES, 'UTF-8') ?></h1>

        <div class="product-price">
            <?php if ($product['price']): ?>
                <?= htmlspecialchars($currency, ENT_QUOTES, 'UTF-8') ?><?= number_format((float) $product['price'], \App\GlobalCommerce::fractionDigits($product['currency'])) ?>
            <?php else: ?>
                <span>가격 확인 필요</span>
            <?php endif; ?>
        </div>

        <?php if ($product['analysis_status'] === 'needs_review'): ?>
            <div class="analysis-warning">
                <?php if ($isCoupang): ?>
                    쿠팡의 자동화 접근 제한으로 가격·이미지·옵션을 확인하지 못했습니다.
                    원본 페이지를 확인한 뒤 옵션과 요청사항을 직접 입력해 주세요.
                <?php else: ?>
                    자동으로 확인하지 못한 정보가 있습니다. 원본 페이지와 함께 확인해 주세요.
                <?php endif; ?>
            </div>
        <?php endif; ?>

        <a class="product-description-link" href="#product-description">상품 상세설명 보기 ↓</a>

        <form id="product-action-form">
            <?php foreach ($options as $index => $option): ?>
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

            <?php if (!$options): ?>
                <label>
                    옵션 직접 입력
                    <input
                        name="manual_option"
                        data-option-name="직접 입력 옵션"
                        placeholder="색상, 크기 등 원하는 옵션을 입력해 주세요">
                </label>
            <?php endif; ?>

            <label>
                수량
                <input name="quantity" type="number" min="1" max="20" value="1" required>
            </label>
            <label>
                요청사항
                <textarea
                    name="request_note"
                    rows="4"
                    maxlength="1000"
                    placeholder="판매자에게 전달할 요청이나 확인할 내용을 입력해 주세요"></textarea>
            </label>

            <div class="product-actions">
                <button type="button" class="secondary" id="add-cart-button">장바구니 담기</button>
                <button type="button" class="primary" id="buy-now-button">구매하기 <span>→</span></button>
            </div>
            <div id="product-action-message" class="form-message"></div>
        </form>
    </div>
</section>

<div class="product-information">
    <nav class="product-section-links" aria-label="상품 상세 정보">
        <a href="#product-description">상품 상세설명</a>
        <a href="#purchase-guide">구매대행 안내</a>
    </nav>

    <section id="product-description" class="product-description-section" aria-labelledby="description-title">
        <header>
            <span class="eyebrow">PRODUCT DETAILS</span>
            <h2 id="description-title">상품 상세설명</h2>
            <p class="muted">판매처에서 확인한 상품 정보입니다. 최신 정보는 원본 상품 페이지를 확인해 주세요.</p>
        </header>
        <?php if ($detailBlocks): ?>
            <div id="product-description-body" class="product-description-content">
                <?php foreach ($detailBlocks as $block): ?>
                    <?php if ($block['type'] === 'image'): ?>
                        <figure>
                            <img src="<?= htmlspecialchars($block['url'], ENT_QUOTES, 'UTF-8') ?>"
                                alt="<?= htmlspecialchars($block['alt'] ?: '상품 상세 이미지', ENT_QUOTES, 'UTF-8') ?>"
                                loading="lazy" decoding="async" referrerpolicy="no-referrer">
                        </figure>
                    <?php elseif ($block['type'] === 'heading'): ?>
                        <h3><?= htmlspecialchars($block['text'], ENT_QUOTES, 'UTF-8') ?></h3>
                    <?php elseif ($block['type'] === 'specification'): ?>
                        <dl class="product-specification">
                            <dt><?= htmlspecialchars($block['name'], ENT_QUOTES, 'UTF-8') ?></dt>
                            <dd><?= htmlspecialchars($block['text'], ENT_QUOTES, 'UTF-8') ?></dd>
                        </dl>
                    <?php else: ?>
                        <p><?= htmlspecialchars($block['text'], ENT_QUOTES, 'UTF-8') ?></p>
                    <?php endif; ?>
                <?php endforeach; ?>
            </div>
            <button type="button" class="product-description-toggle" aria-controls="product-description-body" aria-expanded="false" hidden>상세설명 전체보기 ↓</button>
        <?php else: ?>
            <div class="product-description-empty">
                상세설명을 자동으로 가져오지 못했습니다. 원본 상품 페이지에서 확인해 주세요.
            </div>
        <?php endif; ?>
        <a class="source-host" href="<?= htmlspecialchars($product['final_url'], ENT_QUOTES, 'UTF-8') ?>"
            target="_blank" rel="noopener noreferrer">원본 상품 페이지 보기 ↗</a>
    </section>

    <section id="purchase-guide" class="product-purchase-guide" aria-labelledby="purchase-guide-title">
        <h2 id="purchase-guide-title">구매대행 안내</h2>
        <ul>
            <li>신청 후 상품 재고, 선택 옵션과 구매 가능 여부를 확인합니다.</li>
            <li>배송 국가에 따른 배송 가능 여부와 배송비·수수료·세금은 별도로 확인합니다.</li>
            <li>판매처의 상품 정보와 가격은 변경될 수 있으며, 표시 금액은 최종 결제 금액이 아닙니다.</li>
        </ul>
    </section>
</div>
