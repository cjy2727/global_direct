<?php

declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\GlobalCommerce;

/** 운영 DB 없이 국가 검증, 미확인 견적과 환율 스냅샷을 검증한다. */
function check(bool $condition): void
{
    if (!$condition) throw new RuntimeException('GlobalCommerceTest assertion failed');
}

function rejects(callable $operation): void
{
    try { $operation(); } catch (RuntimeException) { return; }
    throw new RuntimeException('Expected validation error');
}

putenv('KRW_PER_JPY=9.15');
putenv('USD_JPY_RATE=150');
check(GlobalCommerce::country('de') === 'DE');
check(GlobalCommerce::country('', true) === null);
rejects(fn() => GlobalCommerce::country('ZZ'));
$address = ['country_code' => 'HK', 'recipient' => 'Fixture', 'address1' => 'Test address', 'phone' => '+852 00000000'];
check(GlobalCommerce::address($address)['postal_code'] === '');
rejects(fn() => GlobalCommerce::address(array_merge($address, ['country_code' => 'US'])));
rejects(fn() => GlobalCommerce::address(array_merge($address, ['recipient' => []])));
$quote = GlobalCommerce::quote(10.25, 'EUR', 'EUR', 2, true);
check($quote['product_subtotal'] === 20.5);
check($quote['total'] === null && $quote['shipping_fee'] === null);
check(GlobalCommerce::quote(10, 'USD', 'JPY', 2, true)['product_subtotal'] === 3000.0);
check(GlobalCommerce::quote(9150, 'KRW', 'USD', 3, true)['product_subtotal'] === 20.0);
check(GlobalCommerce::quote(10, 'EUR', 'USD', 1, true)['product_subtotal'] === null);
check(GlobalCommerce::quote(null, 'USD', 'USD', 1, true)['product_subtotal'] === null);
check(GlobalCommerce::quote(10, 'USD', 'USD', 1, false)['product_subtotal'] === null);
check(GlobalCommerce::quote(0, 'USD', 'USD', 1, true)['product_subtotal'] === null);
check(GlobalCommerce::quote(1.234, 'KWD', 'KWD', 2, true)['product_subtotal'] === 2.468);
rejects(fn() => GlobalCommerce::quote(10, 'USD', 'ZZZ', 1, true));
rejects(fn() => GlobalCommerce::quote(10, 'USD', 'USD', 0, true));
putenv('USD_JPY_RATE=0');
check(GlobalCommerce::quote(10, 'USD', 'JPY', 1, true)['product_subtotal'] === null);
check($quote['source_currency'] === 'EUR' && $quote['exchange_rate'] === 1.0);
echo "GlobalCommerceTest: OK\n";
