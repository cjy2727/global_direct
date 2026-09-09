CREATE TABLE IF NOT EXISTS quotes (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    public_id CHAR(12) NOT NULL UNIQUE,
    source_url TEXT NOT NULL,
    mall VARCHAR(80) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_price_krw INT UNSIGNED NOT NULL,
    quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1,
    status VARCHAR(32) NOT NULL DEFAULT 'review_pending',
    estimate_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS orders (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_no VARCHAR(32) NOT NULL UNIQUE,
    quote_id BIGINT UNSIGNED NULL,
    customer_name VARCHAR(100) NOT NULL,
    customer_email VARCHAR(190) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'review_pending',
    total_jpy INT UNSIGNED NOT NULL,
    source_url TEXT NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_orders_quote FOREIGN KEY (quote_id) REFERENCES quotes(id) ON DELETE SET NULL,
    INDEX idx_orders_status_created (status, created_at)
);

CREATE TABLE IF NOT EXISTS order_status_history (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    from_status VARCHAR(32) NULL,
    to_status VARCHAR(32) NOT NULL,
    note VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_history_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_history_order_created (order_id, created_at)
);

INSERT IGNORE INTO orders
    (id, order_no, customer_name, customer_email, status, total_jpy, source_url, product_name)
VALUES
    (1, 'GD-260909-DEMO', '김민지', 'demo@example.test', 'warehouse_received', 7280, 'https://example.kr/products/demo', '한정판 미니 크로스백');

INSERT IGNORE INTO order_status_history (id, order_id, from_status, to_status, note)
VALUES
    (1, 1, NULL, 'review_pending', '구매대행 신청 접수'),
    (2, 1, 'review_pending', 'confirmed', '상품 정보 확인 완료'),
    (3, 1, 'confirmed', 'local_ordered', '현지 판매처 주문 완료'),
    (4, 1, 'local_ordered', 'warehouse_received', '현지 창고 입고');
