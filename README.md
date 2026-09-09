# GlobalDirect

한국 상품을 일본 고객이 URL 하나로 견적 받고 주문할 수 있는 구매대행 MVP입니다.

## 기술 스택

- PHP 8.3 (의존성 없는 경량 MVC)
- Vanilla JavaScript / CSS
- MySQL 8.4
- Redis 7
- Nginx
- Docker Compose

## 실행

```powershell
docker compose up --build -d
```

웹: http://localhost:8088  
관리자 데모: http://localhost:8088/admin

초기 실행 시 `database/schema.sql`이 자동 적용됩니다. 실제 결제 및 외부 쇼핑몰 주문은 구현하지 않았으며 모든 견적은 데모 데이터입니다.

## 주요 화면

- `/` URL 입력, 자동 견적, 이용 흐름
- `/orders` 주문 배송 추적 데모
- `/admin` 운영자 주문 큐와 상태 변경
- `/api/quote` URL 분석/견적 API
- `/api/orders` 주문 목록 API

상세 제품 요구사항과 운영 규칙은 [docs/PRODUCT.md](docs/PRODUCT.md), 시스템 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.
