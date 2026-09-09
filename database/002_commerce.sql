CREATE TABLE users (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    email VARCHAR(190) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    role ENUM('customer', 'operator', 'admin') NOT NULL DEFAULT 'customer',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE addresses (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NOT NULL,
    label VARCHAR(50) NOT NULL DEFAULT '自宅',
    recipient VARCHAR(100) NOT NULL,
    postal_code VARCHAR(12) NOT NULL,
    prefecture VARCHAR(40) NOT NULL,
    city VARCHAR(100) NOT NULL,
    address1 VARCHAR(190) NOT NULL,
    address2 VARCHAR(190) NULL,
    phone VARCHAR(30) NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_addresses_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_addresses_user (user_id)
);

ALTER TABLE orders
    ADD COLUMN user_id BIGINT UNSIGNED NULL AFTER id,
    ADD COLUMN option_text VARCHAR(500) NULL AFTER product_name,
    ADD COLUMN quantity SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER option_text,
    ADD COLUMN address_json JSON NULL AFTER quantity,
    ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    ADD INDEX idx_orders_user_created (user_id, created_at);

CREATE TABLE inspections (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    result ENUM('passed', 'issue', 'blocked') NOT NULL,
    quantity_ok BOOLEAN NOT NULL,
    exterior_ok BOOLEAN NOT NULL,
    option_ok BOOLEAN NOT NULL,
    note VARCHAR(1000) NULL,
    inspected_by VARCHAR(100) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_inspections_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    INDEX idx_inspections_order (order_id)
);

CREATE TABLE shipments (
    id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    order_id BIGINT UNSIGNED NOT NULL,
    carrier VARCHAR(60) NOT NULL,
    tracking_no VARCHAR(120) NOT NULL,
    status VARCHAR(60) NOT NULL DEFAULT 'label_created',
    last_event_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_shipments_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    UNIQUE KEY uq_carrier_tracking (carrier, tracking_no),
    INDEX idx_shipments_order (order_id)
);

CREATE TABLE schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO schema_migrations (version) VALUES ('002_commerce');
