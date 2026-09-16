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

- 현재 상품 분석은 PHP에서 내부 HTTP 응답을 기다리는 동기 방식이다. Redis 작업 큐 분리는 후속 단계다.
- Redis에는 상품 분석 작업의 진행 상태와 결과 상품 ID를 보관하며 Redis 장애 시에도 MySQL 기반 핵심 흐름은 계속 동작한다.
- 상품 원본 스냅샷과 고객이 승인한 견적을 주문에 복제하여 이후 원본 가격 변동과 분리한다.
- 주문 상태는 임의 문자열 갱신이 아니라 허용된 전이표를 통해서만 바꾼다.
- 실제 현지 주문은 전용 어댑터 없이는 실행하지 않는다.
- `ProductSourceAdapter`, `ShippingCarrier` 인터페이스가 외부 연동과 핵심 주문 로직을 분리한다.
- 비밀번호와 인증정보는 로그에 기록하지 않는다. 운영 환경의 비밀값은 `.env`로만 주입한다.

## 견적 공식

```text
상품 소계(견적 통화) = 상품 단가(원화폐) × 수량 × 적용 환율
동일 통화: 환율 1
서로 다른 통화: 설정된 KRW/JPY/USD 환율 조합만 사용
미확인 상품 또는 미지원 환율: 상품 소계 null
배송비 / 대행비 / 세금 / 총액: 확정 전 null
```

MVP 계산값은 안내용이며 실제 청구 금액으로 사용하지 않는다.

## 글로벌 주문과 기존 데이터

`GlobalCommerce`가 국가·주소·견적 입력을 검증한다. 국가와 통화 목록은 입력 카탈로그이며 배송이나 결제 지원을 보장하지 않는다. 화면 언어는 국가 및 통화와 분리하며 현재 한국어로 제공한다.

`orders.commerce_json`에는 구매국, 배송국, 경로 검토 상태, 요청사항과 견적 스냅샷을 보관한다. 스냅샷은 원화폐, 원 단가, 견적 통화, 환율, 환율 출처, 계산 시각, 수량, 상품 소계와 미확정 비용을 포함한다. 이후 환경 환율 변경은 기존 스냅샷을 바꾸지 않는다.

`005_global_orders.sql`은 nullable JSON 열을 추가하고 상품 가격을 `DECIMAL(19,4)`로 확장하여 세 자리 소수 통화의 원 단가를 보존한다. 기존 주문의 `total_jpy`와 주소는 그대로 보존하며 `commerce_json = null`인 주문은 이전 형식으로 읽는다. 신규 주문의 `total_jpy = 0`은 호환용이며 금액 표시에 사용하지 않는다. 사용하지 않는 기존 주소록/견적 테이블의 국가별 필드는 후속 기능 도입 시 이전한다.

기존 설치에는 `docker compose run --rm --no-deps php php src/migrate-global.php`를 한 번 실행한다(MySQL이 실행 중이어야 함). 이 명령은 열 존재 여부를 확인하므로 재실행할 수 있다. 새 데이터 디렉터리는 Compose 초기화 스크립트가 적용한다. 기존 SQL 파일 재실행이나 볼륨 초기화는 하지 않는다.
