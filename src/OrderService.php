<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class OrderService
{
    private SimpleMySql $db;

    public function __construct(?SimpleMySql $db = null)
    {
        $this->db = $db ?? new SimpleMySql();
    }

    public function createFromProduct(array $user, string $publicId, array $input): array
    {
        $product = (new ProductService($this->db))->find($publicId);
        $quantity = filter_var($input['quantity'] ?? 1, FILTER_VALIDATE_INT);
        if ($quantity === false || $quantity < 1 || $quantity > 20) {
            throw new RuntimeException('수량은 1~20개로 입력해 주세요.');
        }
        $address = GlobalCommerce::address($input['address'] ?? null);
        $sourceCountry = GlobalCommerce::country($input['source_country'] ?? null, true);
        $quoteCurrency = $input['quote_currency'] ?? '';
        if (!is_string($quoteCurrency)) throw new RuntimeException('견적 통화를 확인해 주세요.');
        $requestNote = $input['request_note'] ?? '';
        if (!is_string($requestNote) || strlen($requestNote) > 4000) {
            throw new RuntimeException('요청사항은 1000자 이내로 입력해 주세요.');
        }

        $validated = ProductOptions::validate($product['options'], $input['selected_options'] ?? []);
        $optionText = implode(' / ', array_map(
            static fn($key, $value) => $key . ': ' . $value,
            array_keys($validated['labels']), array_values($validated['labels'])
        ));
        // 기존 요약 열은 500자까지, 원문 전체와 식별자는 commerce_json에 보존한다.
        $characters = preg_split('//u', $optionText, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        $optionText = implode('', array_slice($characters, 0, 500));
        $unitPrice = isset($product['price']) && $validated['price_delta'] !== null
            ? (float) $product['price'] + $validated['price_delta'] : null;
        $quote = GlobalCommerce::quote(
            $unitPrice,
            (string) ($product['currency'] ?? ''), $quoteCurrency, $quantity,
            $product['analysis_status'] === 'complete'
        );
        $commerce = [
            'version' => 1,
            'source_country' => $sourceCountry,
            'destination_country' => $address['country_code'],
            'route_status' => 'review_pending',
            'quote' => $quote,
            'request_note' => $requestNote,
            'selected_options' => $validated['selected'],
            'option_labels' => $validated['labels'],
            'option_price_delta' => $validated['price_delta'],
        ];
        $orderNo = 'GD-' . date('ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));
        return $this->db->transaction(function (SimpleMySql $db) use ($user, $product, $orderNo, $commerce, $optionText, $quantity, $address, $input): array {
            $orderId = (int) $db->insert('orders', [
                'user_id' => $user['id'],
                'product_id' => $product['id'],
                'order_no' => $orderNo,
                'customer_name' => $user['name'],
                'customer_email' => $user['email'],
                'status' => 'review_pending',
                // 이전 스키마와의 호환용 값이며 신규 주문 금액은 commerce_json을 사용한다.
                'total_jpy' => 0,
                'commerce_json' => json_encode($commerce, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR),
                'source_url' => $product['source_url'],
                'product_name' => $product['title'],
                'option_text' => $optionText,
                'quantity' => $quantity,
                'address_json' => json_encode($address, JSON_UNESCAPED_UNICODE),
            ]);
            $note = '구매대행 신청 접수';
            if (!empty($input['request_note'])) {
                $note .= ' · 요청사항 있음';
            }
            $db->insert('order_status_history', [
                'order_id' => $orderId,
                'from_status' => null,
                'to_status' => 'review_pending',
                'note' => $note,
            ]);

            return [
                'order_no' => $orderNo,
                'status' => 'review_pending',
                'commerce' => $commerce,
            ];
        });
    }

    public static function estimateTotalJpy(float $unitPrice, string $currency, int $quantity): int
    {
        $quantity = max(1, $quantity);
        $krwPerJpy = max(0.000001, (float) \env_value('KRW_PER_JPY'));
        $usdJpyRate = max(0, (float) \env_value('USD_JPY_RATE'));

        return match (strtoupper($currency)) {
            'JPY' => (int) ceil($unitPrice * $quantity),
            'KRW' => (int) ceil($unitPrice * $quantity / $krwPerJpy),
            'USD' => (int) ceil($unitPrice * $quantity * $usdJpyRate),
            default => 0,
        };
    }

    public function mine(int $userId):array
    {
        $sql = <<<'SQL'
            SELECT o.order_no,
                   o.status,
                   o.total_jpy,
                   o.commerce_json,
                   o.product_name,
                   o.quantity,
                   o.created_at,
                   p.public_id AS product_public_id
              FROM orders o
              LEFT JOIN products p ON p.id = o.product_id
             WHERE o.user_id = :user_id
             ORDER BY o.created_at DESC
            SQL;

        return array_map(static function (array $order): array {
            $order['commerce'] = $order['commerce_json'] === null ? null : json_decode($order['commerce_json'], true);
            unset($order['commerce_json']);
            return $order;
        }, $this->db->fetchAll($sql, ['user_id' => $userId]));
    }
}
