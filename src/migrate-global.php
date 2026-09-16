<?php

declare(strict_types=1);

// 기존 설치용 추가 전용 마이그레이션. 기존 주문과 금액을 갱신하지 않는다.
if (PHP_SAPI !== 'cli') exit(1);
require __DIR__ . '/bootstrap.php';

try {
    $db = new \App\SimpleMySql();
    $exists = $db->value("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'orders' AND COLUMN_NAME = 'commerce_json'");
    if (!(int) $exists) $db->execute('ALTER TABLE orders ADD COLUMN commerce_json JSON NULL');
    $scale = $db->value("SELECT NUMERIC_SCALE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'price'");
    if ($scale !== null && (int) $scale < 4) $db->execute('ALTER TABLE products MODIFY COLUMN price DECIMAL(19,4) NULL');
    $db->execute("INSERT IGNORE INTO schema_migrations (version) VALUES ('005_global_orders')");
    echo "005_global_orders: OK (existing rows preserved)\n";
} catch (Throwable) {
    fwrite(STDERR, "005_global_orders: failed; verify database connectivity and schema permissions.\n");
    exit(1);
}
