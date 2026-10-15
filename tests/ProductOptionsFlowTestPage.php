<?php
declare(strict_types=1);
// 기존 상세/신청서 fixture를 실제 템플릿으로 렌더링해 브라우저 테스트에 전달한다.
ob_start();
require __DIR__ . '/ProductOptionsTest.php';
ob_end_clean();
$product = [
    'public_id' => '0123456789abcdef', 'images' => [], 'options' => $definitions,
    'currency' => 'KRW', 'source_host' => 'example.test', 'final_url' => 'https://example.test/item',
    'title' => 'Fixture', 'price' => 10000, 'analysis_status' => 'complete', 'description' => '', 'detail_blocks' => [],
];
$title = 'Fixture';
$result = [];
foreach (['product', 'request'] as $view) {
    ob_start();
    require dirname(__DIR__) . '/views/layout.php';
    $result[$view . 'Html'] = ob_get_clean();
}
echo json_encode($result, JSON_THROW_ON_ERROR);
