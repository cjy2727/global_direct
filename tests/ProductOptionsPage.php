<?php
declare(strict_types=1);
ob_start();
require __DIR__ . '/ProductOptionsTest.php';
ob_end_clean();
$product = [
    'public_id' => '0123456789abcdef', 'images' => [], 'options' => $definitions,
    'currency' => 'KRW', 'source_host' => 'example.test', 'final_url' => 'https://example.test/item',
    'title' => 'Fixture', 'price' => 10000, 'analysis_status' => 'complete', 'description' => '', 'detail_blocks' => [],
];
$view = in_array('--request', $argv, true) ? 'request' : 'product';
$title = 'Fixture';
require dirname(__DIR__) . '/views/layout.php';
