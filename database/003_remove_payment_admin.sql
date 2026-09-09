UPDATE orders SET status = 'review_pending' WHERE status IN ('payment_pending', 'paid');
UPDATE order_status_history SET from_status = 'review_pending' WHERE from_status IN ('payment_pending', 'paid');
UPDATE order_status_history SET to_status = 'review_pending' WHERE to_status IN ('payment_pending', 'paid');
UPDATE order_status_history SET note = '기존 주문 상태를 신청 검토 중으로 변환' WHERE note LIKE '%결제%' OR note LIKE '%payment%';
INSERT INTO schema_migrations (version) VALUES ('003_remove_payment_admin');
