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

초기 실행 시 데이터베이스 스키마가 자동 적용됩니다. 외부 쇼핑몰 주문은 구현하지 않았으며 모든 견적은 테스트 데이터입니다.

## 주요 화면

- `/` URL 입력과 Playwright 상품 분석
- `/orders` 주문 배송 추적 데모
- `/products/{상품ID}` 분석된 상품 상세, 이미지와 옵션
- `/cart` 장바구니
- `/api/products/analyze` Playwright 상품 분석 API
- `/api/orders` 구매대행 신청 API
- `/account` 회원가입, 로그인, 내 주문
- `/request` 배송지와 옵션을 포함한 구매대행 신청

외부 쇼핑몰 주문과 배송사 연동은 아직 연결하지 않았습니다. 상품 분석은 별도 Playwright 컨테이너에서 실행됩니다.

## MySQL 편의 클래스

`App\\SimpleMySql`은 기존 PDO 연결을 재사용하며 조회, 추가, 수정, 삭제,
일괄 추가, upsert, 배열 파라미터와 트랜잭션을 제공합니다.

```php
$db = new App\SimpleMySql();

$product = $db->fetchOne(
    'SELECT * FROM products WHERE public_id = :public_id',
    ['public_id' => $publicId]
);

$id = $db->insert('cart_items', [
    'cart_id' => $cartId,
    'product_id' => $productId,
    'quantity' => 1,
    'selected_options_json' => '{}',
]);
```

상세 제품 요구사항과 운영 규칙은 [docs/PRODUCT.md](docs/PRODUCT.md), 시스템 구조는 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)를 참고하세요.
