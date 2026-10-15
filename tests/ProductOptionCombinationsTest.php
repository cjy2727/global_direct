<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\ProductOptions;

/** 로컬 정의로 조합 위조, 품절, 가격 중복 합산, JSON 저장 호환을 검사한다. */
$options = [
    ['id' => 'color', 'name' => 'Color', 'type' => 'select', 'required' => true, 'values' => [
        ['id' => 'black', 'label' => 'Black', 'priceDelta' => null, 'disabled' => false],
        ['id' => 'white', 'label' => 'White', 'priceDelta' => null, 'disabled' => false],
    ], 'combinationGroupIds' => ['color', 'size'], 'combinations' => [
        ['values' => ['color' => 'black', 'size' => 'S'], 'disabled' => false, 'priceDelta' => 0],
        ['values' => ['color' => 'black', 'size' => 'M'], 'disabled' => true, 'priceDelta' => 100],
        ['values' => ['color' => 'white', 'size' => 'L'], 'disabled' => false, 'priceDelta' => 200],
    ]],
    ['id' => 'size', 'name' => 'Size', 'type' => 'select', 'required' => true, 'values' => array_map(
        static fn($value) => ['id' => $value, 'label' => $value, 'priceDelta' => null, 'disabled' => false], ['S', 'M', 'L'])],
    ['id' => 'note', 'name' => 'Note', 'type' => 'text', 'inputType' => 'text', 'required' => false, 'priceDelta' => 5, 'values' => []],
];
$options = ProductOptions::fromRows(array_map(static fn($group) => [
    'option_name' => $group['name'], 'values_json' => json_encode(['version' => 2] + $group),
], $options));
$result = ProductOptions::validate($options, ['color' => 'white', 'size' => 'L', 'note' => 'Fixture']);
if ($result['price_delta'] !== 205.0) throw new LogicException('Combination price mismatch');
$unknown = $options;
$unknown[0]['combinations'][2]['priceDelta'] = null;
if (ProductOptions::validate($unknown, ['color' => 'white', 'size' => 'L'])['price_delta'] !== null) {
    throw new LogicException('Unknown combination price treated as zero');
}
foreach ([['color' => 'black', 'size' => 'L'], ['color' => 'black', 'size' => 'M'], ['color' => 'white']] as $invalid) {
    try { ProductOptions::validate($options, $invalid); } catch (RuntimeException) { continue; }
    throw new LogicException('Invalid combination accepted');
}
if (in_array('--render', $argv, true)) {
    $product = ['options' => $options, 'currency' => 'USD'];
    echo '<form id="fixture">';
    require dirname(__DIR__) . '/views/product-options.php';
    echo '</form>';
} else {
    echo "ProductOptionCombinationsTest: OK\n";
}
