<?php

declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\ProductContent;

/** 외부 HTML, 잘못된 URL, 이전 상품 설명과 안전한 상세 템플릿 출력을 검사한다. */
function verifyContent(bool $condition): void
{
    if (!$condition) throw new RuntimeException('ProductContentTest assertion failed');
}

$blocks = ProductContent::details(['content' => ['blocks' => [
    ['type' => 'heading', 'text' => '상품 설명'],
    ['type' => 'text', 'text' => '<script>SECRET</script><b>면 소재</b>'],
    ['type' => 'image', 'url' => 'https://images.example.test/detail.jpg', 'alt' => '상세 이미지'],
    ['type' => 'image', 'url' => 'javascript:alert(1)'],
    ['type' => 'image', 'url' => 'https://user:password@example.test/private.jpg'],
    ['type' => 'html', 'text' => '<iframe src="x"></iframe>'],
    ['type' => 'specification', 'name' => '크기', 'text' => '20 cm'],
]]], null);
verifyContent(count($blocks) === 4);
verifyContent($blocks[1]['text'] === '면 소재');
verifyContent(ProductContent::details([], '<p>기존 설명</p>')[0]['text'] === '기존 설명');
verifyContent(ProductContent::details([], null) === []);
verifyContent(ProductContent::imageUrl('data:image/svg+xml,x') === null);
verifyContent(ProductContent::imageUrl('//example.test/x') === null);
verifyContent(ProductContent::imageUrl('http://127.0.0.1/private.jpg') === null);
verifyContent(ProductContent::imageUrl('http://localhost/private.jpg') === null);

$product = [
    'public_id' => '0123456789abcdef', 'images' => ['https://images.example.test/main.jpg', 'https://images.example.test/side.jpg'],
    'options' => [], 'currency' => 'USD', 'source_host' => 'shop.example.test',
    'final_url' => 'https://shop.example.test/item', 'title' => 'Fixture product',
    'price' => 12.34, 'analysis_status' => 'complete', 'description' => '', 'detail_blocks' => $blocks,
];
ob_start();
require dirname(__DIR__) . '/views/product.php';
$html = ob_get_clean();
verifyContent(str_contains($html, 'id="product-description"'));
verifyContent(strpos($html, 'detail.jpg') > strpos($html, 'id="product-description"'));
verifyContent(!str_contains($html, 'SECRET') && !str_contains($html, 'javascript:'));
verifyContent(str_contains($html, '구매대행 안내'));
if (in_array('--render', $argv, true)) {
    $view = 'product';
    $title = 'Fixture product';
    require dirname(__DIR__) . '/views/layout.php';
    exit;
}
echo "ProductContentTest: OK\n";
