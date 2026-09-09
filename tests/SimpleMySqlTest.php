<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\SimpleMySql;

$db = new SimpleMySql();
$publicId = 'test' . bin2hex(random_bytes(6));

try {
    $db->transaction(function (SimpleMySql $db) use ($publicId): void {
        $id = $db->insert('products', [
            'public_id' => $publicId,
            'source_url' => 'https://example.test/product',
            'final_url' => 'https://example.test/product',
            'source_host' => 'example.test',
            'title' => '편의 클래스 테스트 상품',
            'description' => null,
            'price' => 10000,
            'currency' => 'KRW',
            'availability' => null,
            'analysis_status' => 'complete',
            'raw_json' => '{}',
        ]);
        assert((int) $id > 0);

        $product = $db->fetchOne('SELECT * FROM products WHERE public_id = :public_id', ['public_id' => $publicId]);
        assert($product !== null && $product['title'] === '편의 클래스 테스트 상품');
        assert($db->exists('products', 'public_id = :public_id', ['public_id' => $publicId]));
        assert($db->count('products', 'public_id IN (:ids)', ['ids' => [$publicId, '없는상품']]) === 1);

        assert($db->update('products', ['title' => '수정된 테스트 상품'], 'public_id = :public_id', ['public_id' => $publicId]) === 1);
        assert($db->value('SELECT title FROM products WHERE public_id = :public_id', ['public_id' => $publicId]) === '수정된 테스트 상품');

        assert($db->insertMany('product_images', [
            ['product_id' => (int) $id, 'image_url' => 'https://example.test/1.jpg', 'sort_order' => 0],
            ['product_id' => (int) $id, 'image_url' => 'https://example.test/2.jpg', 'sort_order' => 1],
        ]) === 2);
        assert($db->count('product_images', 'product_id = :product_id', ['product_id' => (int) $id]) === 2);

        $upserted = $db->upsert('products', [
            'public_id' => $publicId,
            'source_url' => 'https://example.test/product',
            'final_url' => 'https://example.test/product',
            'source_host' => 'example.test',
            'title' => '업서트 테스트 상품',
            'description' => null,
            'price' => 12000,
            'currency' => 'KRW',
            'availability' => null,
            'analysis_status' => 'complete',
            'raw_json' => '{}',
        ], ['title', 'price']);
        assert($upserted >= 1);
        assert($db->value('SELECT title FROM products WHERE public_id = :public_id', ['public_id' => $publicId]) === '업서트 테스트 상품');

        assert($db->delete('product_images', 'product_id = :product_id', ['product_id' => (int) $id]) === 2);
        assert(!$db->exists('product_images', 'product_id = :product_id', ['product_id' => (int) $id]));

        throw new RuntimeException('롤백 검증');
    });
} catch (RuntimeException $exception) {
    assert($exception->getMessage() === '롤백 검증');
}

assert(!$db->exists('products', 'public_id = :public_id', ['public_id' => $publicId]));

echo "SimpleMySqlTest: OK\n";
