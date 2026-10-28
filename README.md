# GlobalDirect URL Analysis API

상품 URL을 받아 Playwright로 분석한 결과 JSON을 반환합니다.
웹 화면, 회원, 세션, 장바구니, 주문, MySQL, Redis를 사용하지 않습니다.

## 실행

    docker compose up --build -d
    docker compose ps

기존 설치 전환 시 --remove-orphans 옵션으로 이전 MySQL/Redis 컨테이너를 제거합니다.
기존 데이터 볼륨은 삭제하지 않습니다. .env는 보존합니다.
필요한 환경 변수: APP_PORT, PRODUCT_WORKER_URL, WORKER_TOKEN.
기존 DB/Redis 환경 변수는 사용하지 않습니다.

## API

- GET /health: 상태 확인
- POST /api/products/analyze: 상품 분석
- 기타 경로(기존 화면 및 회원/주문/장바구니 포함): JSON 404

요청: {"url":"https://shop.example.com/product/123"}

성공: HTTP 200, {"ok":true,"product":{...}}

product는 worker 결과 전체입니다. title, price, currency, sourceUrl, finalUrl,
images, description, content, optionGroups, optionAnalysis, status 등 수집된 필드를 반환합니다.
사이트에 따라 필드가 누락되거나 null일 수 있습니다. needs_review는 불완전한 결과입니다.
저장된 상품 ID나 이 프로젝트의 상품 상세 페이지 주소는 생성하지 않습니다.

JSON/필드 오류: 400. 메서드 오류: 405. URL/분석 실패: 422.
오류 본문: {"ok":false,"message":"..."}

## 브라우저 호출

    const response = await fetch('http://localhost:8088/api/products/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: productUrl })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message);
    console.log(data.product);

CORS: HTTPS의 post.*.shiptao.kr, m2.*.shiptao.kr,
post.malltail.com, m2.malltail.com만 허용. 별표는 하위 도메인 한 단계입니다.
CORS는 브라우저 접근 제어이며 API 인증 기능은 아닙니다.

## 구성 및 검증

Nginx -> PHP API -> 내부 Playwright worker -> 외부 상품 페이지.
Worker의 URL 검사, 내부 네트워크 차단, 토큰 검증, 추출 로직은 유지합니다.
로그인 요구, 자동화 차단, 사이트 구조에 따라 정보가 누락될 수 있습니다.

    docker compose exec -T php php tests/AnalysisApiTest.php
    docker compose exec -T playwright node tests/product-content.test.js
    docker compose exec -T playwright node tests/product-options.test.js
    docker compose exec -T playwright node tests/option-collection.test.js

API 테스트는 로컬 worker 응답 fixture를 사용합니다. 실제 상점 정확성 검증과 다릅니다.
build-and-export.bat는 PHP/Playwright/Nginx 이미지만 반출합니다.
