<?php

declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\SimpleMySql;
use App\ProductService;

// 연결 범위의 임시 테이블만 사용한다. 실제 상품과 이미지는 조회하거나 수정하지 않는다.
$db = new SimpleMySql();
$db->execute('CREATE TEMPORARY TABLE products (id INT, public_id VARCHAR(16), description TEXT, raw_json JSON)');
$db->execute('CREATE TEMPORARY TABLE product_images (product_id INT, image_url TEXT, sort_order INT)');
$db->execute('CREATE TEMPORARY TABLE product_options (product_id INT, option_name VARCHAR(100), values_json JSON, sort_order INT)');
$db->insert('products', ['id' => 1, 'public_id' => '0123456789abcdef', 'description' => 'Summary', 'raw_json' => json_encode([
    'content' => ['version' => 1, 'blocks' => [['type' => 'image', 'url' => 'https://example.test/detail.jpg'], ['type' => 'text', 'text' => '상세 문구']]],
])]);
$db->insert('product_images', ['product_id' => 1, 'image_url' => 'https://example.test/main.jpg', 'sort_order' => 0]);
$product = (new ProductService($db))->find('0123456789abcdef');
if ($product['main_image'] !== 'https://example.test/main.jpg' || count($product['images']) !== 1
    || $product['detail_blocks'][0]['url'] !== 'https://example.test/detail.jpg'
    || $product['detail_blocks'][1]['text'] !== '상세 문구') throw new RuntimeException('Product content snapshot read failed');
$db->insert('products', ['id' => 2, 'public_id' => 'fedcba9876543210', 'description' => '기존 상품 설명', 'raw_json' => '{}']);
$legacy = (new ProductService($db))->find('fedcba9876543210');
if ($legacy['detail_blocks'][0]['text'] !== '기존 상품 설명') throw new RuntimeException('Legacy description fallback failed');
echo "ProductContentStorageTest: OK (temporary fixtures only)\n";
