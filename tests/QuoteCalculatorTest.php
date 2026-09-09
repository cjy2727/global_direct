<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\QuoteCalculator;

$calculator = new QuoteCalculator();
$estimate = $calculator->calculate('https://shop.example.kr/products/123', 2);

assert($estimate['quantity'] === 2);
assert($estimate['total_jpy'] > $estimate['product_jpy']);
assert($estimate['is_estimate'] === true);

try {
    $calculator->calculate('not-a-url');
    throw new RuntimeException('Invalid URL was accepted.');
} catch (InvalidArgumentException) {
}

echo "QuoteCalculatorTest: OK\n";
