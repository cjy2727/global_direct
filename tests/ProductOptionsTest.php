<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\ProductOptions;

/** 명시적으로 예외를 검사하여 필수 항목 우회와 조작된 선택값을 차단한다. */
function checkOptions(bool $condition): void
{
    if (!$condition) throw new LogicException('ProductOptions assertion failed');
}
function rejectOptions(array $definitions, mixed $input): void
{
    try {
        ProductOptions::validate($definitions, $input);
    } catch (RuntimeException) {
        return;
    }
    throw new LogicException('Invalid options accepted');
}
$definitions = ProductOptions::fromRows([
    ['option_name' => '이메일', 'values_json' => json_encode(['version' => 2, 'id' => 'email', 'type' => 'text', 'inputType' => 'email', 'required' => true, 'priceDelta' => 0, 'values' => []])],
    ['option_name' => '동의', 'values_json' => json_encode(['version' => 2, 'id' => 'consent', 'type' => 'select', 'required' => true, 'values' => [
        ['id' => 'yes', 'label' => '동의합니다', 'priceDelta' => 1500, 'disabled' => false],
        ['id' => 'sold', 'label' => '품절', 'priceDelta' => 0, 'disabled' => true],
    ]])],
]);
$valid = ['email' => 'fixture@example.test', 'consent' => 'yes'];
$result = ProductOptions::validate($definitions, $valid);
checkOptions($result['selected'] === $valid && $result['price_delta'] === 1500.0);
rejectOptions($definitions, []);
rejectOptions($definitions, array_merge($valid, ['email' => 'bad']));
rejectOptions($definitions, array_merge($valid, ['consent' => 'sold']));
rejectOptions($definitions, array_merge($valid, ['consent' => 'forged']));
rejectOptions($definitions, array_merge($valid, ['extra' => 'forged']));
rejectOptions($definitions, array_merge($valid, ['email' => []]));
rejectOptions($definitions, 'invalid');
$definitions[0]['priceDelta'] = null;
checkOptions(ProductOptions::validate($definitions, $valid)['price_delta'] === null);
$legacy = ProductOptions::fromRows([['option_name' => 'Size', 'values_json' => '["S","M"]']]);
checkOptions(ProductOptions::validate($legacy, ['Size' => 'M'])['selected'] === ['legacy-0' => 'M']);
echo "ProductOptionsTest: OK\n";
