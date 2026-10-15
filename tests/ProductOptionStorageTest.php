<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\ProductService;
use App\SimpleMySql;

// 연결 전용 임시 테이블로 실제 store/find 경로를 검사하며 운영 테이블을 건드리지 않는다.
$db = new SimpleMySql();
$db->execute('CREATE TEMPORARY TABLE products (id INT AUTO_INCREMENT PRIMARY KEY, public_id VARCHAR(16), source_url TEXT, final_url TEXT, source_host TEXT, title TEXT, description TEXT, price DECIMAL(19,4), currency VARCHAR(10), availability TEXT, analysis_status TEXT, raw_json JSON)');
$db->execute('CREATE TEMPORARY TABLE product_images (product_id INT, image_url TEXT, sort_order INT)');
$db->execute('CREATE TEMPORARY TABLE product_options (product_id INT, option_name TEXT, values_json JSON, sort_order INT)');
$definition = ['id' => 'color', 'name' => 'Color', 'type' => 'select', 'required' => true, 'values' => [
    ['id' => 'red', 'label' => 'Red', 'priceDelta' => null, 'disabled' => false],
], 'combinationGroupIds' => ['color'], 'combinations' => [
    ['values' => ['color' => 'red'], 'disabled' => false, 'priceDelta' => 10],
], 'combinationsComplete' => true];
$analysis = ['status' => 'complete', 'sources' => ['fixture'], 'message' => ''];
$service = new ProductService($db);
$method = new ReflectionMethod(ProductService::class, 'store');
$stored = $method->invoke($service, ['sourceUrl' => 'https://example.test/item', 'title' => 'Fixture',
    'price' => 100, 'currency' => 'USD', 'optionGroups' => [$definition], 'optionAnalysis' => $analysis]);
// MySQL JSON은 객체 키를 정렬하므로 값/형식을 검사하고 PHP 배열 키 순서는 비교하지 않는다.
if ($stored['options'][0]['combinations'] != $definition['combinations'] || $stored['option_analysis'] != $analysis) {
    throw new LogicException('Option snapshot round trip failed');
}
echo "ProductOptionStorageTest: OK (temporary tables only)\n";
