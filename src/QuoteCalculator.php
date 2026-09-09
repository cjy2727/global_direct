<?php

declare(strict_types=1);

namespace App;

use InvalidArgumentException;

final class QuoteCalculator
{
    private const KRW_PER_JPY = 9.15;

    public function calculate(string $url, int $quantity = 1): array
    {
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(parse_url($url, PHP_URL_SCHEME), ['http', 'https'], true)) {
            throw new InvalidArgumentException('유효한 상품 URL을 입력해 주세요.');
        }

        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($host === '' || in_array($host, ['localhost', '127.0.0.1', '::1'], true)) {
            throw new InvalidArgumentException('외부 쇼핑몰 URL만 사용할 수 있습니다.');
        }

        $quantity = max(1, min(20, $quantity));
        $seed = (int) sprintf('%u', crc32($url));
        $unitKrw = 18000 + ($seed % 98000);
        $productJpy = (int) ceil(($unitKrw * $quantity) / self::KRW_PER_JPY);
        $localShipping = $unitKrw >= 50000 ? 0 : 400;
        $serviceFee = (int) ceil($productJpy * 0.05);
        $internationalShipping = 1450 + ($quantity - 1) * 350;
        $tax = $productJpy >= 16666 ? (int) ceil($productJpy * 0.1) : 0;
        $total = $productJpy + $localShipping + $serviceFee + $internationalShipping + $tax;

        return [
            'mall' => preg_replace('/^www\./', '', $host),
            'product_name' => 'URL 상품 자동 견적',
            'unit_price_krw' => $unitKrw,
            'quantity' => $quantity,
            'product_jpy' => $productJpy,
            'local_shipping_jpy' => $localShipping,
            'service_fee_jpy' => $serviceFee,
            'international_shipping_jpy' => $internationalShipping,
            'estimated_tax_jpy' => $tax,
            'total_jpy' => $total,
            'exchange_rate' => self::KRW_PER_JPY,
            'is_estimate' => true,
        ];
    }
}
