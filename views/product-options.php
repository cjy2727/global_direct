<?php // 상세 페이지와 신청서에서 같은 옵션 정의와 필수 여부를 사용한다. ?>
<?php if (!empty($product['option_analysis']['message'])): ?>
    <p class="analysis-warning"><?= htmlspecialchars($product['option_analysis']['message'], ENT_QUOTES, 'UTF-8') ?></p>
<?php endif; ?>
<?php foreach ($product['options'] as $definition): ?>
    <?php if (!empty($definition['combinations'])): ?>
        <script type="application/json" data-option-combinations><?= json_encode([
            'ids' => $definition['combinationGroupIds'], 'rows' => $definition['combinations'],
        ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) ?></script>
    <?php endif; ?>
<?php endforeach; ?>
<?php foreach ($product['options'] as $index => $option): ?>
    <label>
        <?= htmlspecialchars($option['name'], ENT_QUOTES, 'UTF-8') ?><?= $option['required'] ? ' (필수)' : '' ?>
        <?php if ($option['type'] === 'text'): ?>
            <input type="<?= $option['inputType'] ?>" name="option_<?= $index ?>"
                data-option-name="<?= htmlspecialchars($option['name'], ENT_QUOTES, 'UTF-8') ?>"
                data-option-id="<?= htmlspecialchars($option['id'], ENT_QUOTES, 'UTF-8') ?>"
                placeholder="<?= htmlspecialchars($option['placeholder'], ENT_QUOTES, 'UTF-8') ?>"
                maxlength="500" <?= $option['required'] ? 'required' : '' ?>>
        <?php else: ?>
            <select name="option_<?= $index ?>"
                data-option-name="<?= htmlspecialchars($option['name'], ENT_QUOTES, 'UTF-8') ?>"
                data-option-id="<?= htmlspecialchars($option['id'], ENT_QUOTES, 'UTF-8') ?>"
                <?= $option['required'] ? 'required' : '' ?>>
                <option value="">선택해 주세요</option>
                <?php foreach ($option['values'] as $choice): ?>
                    <option value="<?= htmlspecialchars($choice['id'], ENT_QUOTES, 'UTF-8') ?>" data-source-disabled="<?= $choice['disabled'] ? '1' : '0' ?>" <?= $choice['disabled'] ? 'disabled' : '' ?>>
                        <?= htmlspecialchars($choice['label'], ENT_QUOTES, 'UTF-8') ?>
                        <?php if ($choice['priceDelta'] !== null && (float) $choice['priceDelta'] !== 0.0): ?>
                            (추가금액 <?= htmlspecialchars($product['currency'], ENT_QUOTES, 'UTF-8') ?> <?= number_format((float) $choice['priceDelta'], \App\GlobalCommerce::fractionDigits($product['currency'])) ?>)
                        <?php endif; ?>
                    </option>
                <?php endforeach; ?>
            </select>
        <?php endif; ?>
    </label>
<?php endforeach; ?>
<?php if (!$product['options']): ?>
    <label>옵션 직접 입력
        <input name="manual_option" data-option-name="직접 입력 옵션" maxlength="500" placeholder="색상, 크기 등 원하는 옵션">
    </label>
<?php endif; ?>
