# 시스템 아키텍처

```text
Browser
  │ HTTPS
Nginx
  ├─ /assets/* → static files
  └─ /* → PHP-FPM
             ├─ MySQL: users, quotes, orders, status history
             └─ Redis: sessions, quote cache, crawl queue, idempotency

PHP → 내부 HTTP → Playwright Chromium
                    └─ JSON-LD, Open Graph, DOM 상품 정보 분석

Worker (후속 단계)
  └─ Redis queue → mall adapters → normalized product snapshot
```

## 경계

- 웹 요청에서 외부 쇼핑몰을 오래 기다리지 않는다. 수집은 Redis 큐로 분리한다.
- Redis에는 상품 분석 작업의 진행 상태와 결과 상품 ID를 보관하며 Redis 장애 시에도 MySQL 기반 핵심 흐름은 계속 동작한다.
- 상품 원본 스냅샷과 고객이 승인한 견적을 주문에 복제하여 이후 원본 가격 변동과 분리한다.
- 주문 상태는 임의 문자열 갱신이 아니라 허용된 전이표를 통해서만 바꾼다.
- 실제 현지 주문은 전용 어댑터 없이는 실행하지 않는다.
- `ProductSourceAdapter`, `ShippingCarrier` 인터페이스가 외부 연동과 핵심 주문 로직을 분리한다.
- 비밀번호와 인증정보는 로그에 기록하지 않는다. 운영 환경의 비밀값은 `.env`로만 주입한다.

## 견적 공식

```text
상품가(JPY) = 상품가(KRW) / KRW_PER_JPY
소계 = 상품가 + 한국 내 배송비 + 대행비
예상 세금 = 과세 대상 소계 × 세율
총액 = 소계 + 예상 세금 + 국제 배송비
```

MVP 계산값은 안내용이며 실제 청구 금액으로 사용하지 않는다.
