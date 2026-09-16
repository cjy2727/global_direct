-- 기존 주문과 JPY 금액은 변경하지 않는다. NULL은 이전 형식의 주문을 의미한다.
ALTER TABLE orders ADD COLUMN commerce_json JSON NULL;
-- 기존 정수부 13자리와 소수부를 모두 보존하면서 통화별 소수 정밀도를 확장한다.
ALTER TABLE products MODIFY COLUMN price DECIMAL(19,4) NULL;
INSERT INTO schema_migrations (version) VALUES ('005_global_orders');
