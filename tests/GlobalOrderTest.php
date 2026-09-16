<?php

declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\SimpleMySql;
use App\OrderService;

/** 연결 전용 임시 테이블로 실제 주문 저장/조회 코드를 실행한다. 운영 행은 읽지 않는다. */
function verify(bool $condition): void
{
    if (!$condition) throw new RuntimeException('GlobalOrderTest assertion failed');
}

$db = new SimpleMySql();
$db->execute('CREATE TEMPORARY TABLE products (id INT, public_id VARCHAR(16), title VARCHAR(100), price DECIMAL(19,4), currency VARCHAR(10), analysis_status VARCHAR(30), source_url TEXT)');
$db->execute('CREATE TEMPORARY TABLE product_images (product_id INT, image_url TEXT, sort_order INT)');
$db->execute('CREATE TEMPORARY TABLE product_options (product_id INT, option_name VARCHAR(100), values_json JSON, sort_order INT)');
$db->execute('CREATE TEMPORARY TABLE orders (id INT AUTO_INCREMENT PRIMARY KEY, user_id INT, product_id INT, order_no VARCHAR(32), customer_name VARCHAR(100), customer_email VARCHAR(190), status VARCHAR(32), total_jpy INT, commerce_json JSON, source_url TEXT, product_name VARCHAR(100), option_text VARCHAR(500), quantity INT, address_json JSON, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)');
$db->execute('CREATE TEMPORARY TABLE order_status_history (id INT AUTO_INCREMENT PRIMARY KEY, order_id INT, from_status VARCHAR(32), to_status VARCHAR(32), note VARCHAR(500))');
$db->insert('products', ['id' => 1, 'public_id' => '0123456789abcdef', 'title' => 'Fixture', 'price' => 12.34, 'currency' => 'EUR', 'analysis_status' => 'complete', 'source_url' => 'https://example.test/item']);
$service = new OrderService($db);
$user = ['id' => 123, 'name' => 'Fixture', 'email' => 'fixture@example.test'];
$input = [
    'quantity' => 2, 'source_country' => 'DE', 'quote_currency' => 'EUR', 'request_note' => 'Fixture note',
    'address' => ['country_code' => 'HK', 'recipient' => 'Fixture', 'address1' => 'Fixture street', 'phone' => '+852 00000000'],
];
$created = $service->createFromProduct($user, '0123456789abcdef', $input);
verify($created['commerce']['quote']['product_subtotal'] === 24.68);
$stored = $db->fetchOne('SELECT * FROM orders LIMIT 1');
$snapshot = json_decode($stored['commerce_json'], true);
verify($snapshot['request_note'] === 'Fixture note');
verify($snapshot['source_country'] === 'DE' && $snapshot['destination_country'] === 'HK');
verify($snapshot['quote']['total'] === null);
verify(json_decode($stored['address_json'], true)['country_code'] === 'HK');
putenv('USD_JPY_RATE=999');
verify($service->mine(123)[0]['commerce']['quote']['product_subtotal'] === 24.68);
verify($service->mine(456) === []);
$db->insert('orders', ['user_id' => 123, 'order_no' => 'LEGACY-FIXTURE', 'total_jpy' => 7280]);
$orders = $service->mine(123);
$legacy = array_values(array_filter($orders, fn($order) => $order['order_no'] === 'LEGACY-FIXTURE'))[0];
verify($legacy['commerce'] === null && (int) $legacy['total_jpy'] === 7280);
try {
    $service->createFromProduct($user, '0123456789abcdef', array_merge($input, ['quantity' => 0]));
    throw new LogicException('Invalid quantity was accepted');
} catch (RuntimeException) {
    verify((int) $db->value('SELECT COUNT(*) FROM orders') === 2);
}
$db->execute("UPDATE products SET price = 1.234, currency = 'KWD'");
$precise = $service->createFromProduct($user, '0123456789abcdef', array_merge($input, ['quote_currency' => 'KWD']));
verify($precise['commerce']['quote']['product_subtotal'] === 2.468);

// 국가와 통화 선택 및 원화폐 소수 금액이 실제 PHP 템플릿에 렌더링되는지 확인한다.
$product = (new \App\ProductService($db))->find('0123456789abcdef');
ob_start();
require dirname(__DIR__) . '/views/request.php';
$html = ob_get_clean();
verify(str_contains($html, 'KWD 1.234'));
verify(str_contains($html, 'name="country_code"'));
verify(str_contains($html, 'value="DE"'));
verify(str_contains($html, 'name="quote_currency"'));
echo "GlobalOrderTest: OK (temporary fixtures and template rendering)\n";
