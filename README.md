# GlobalDirect URL Analysis API

상품 URL을 받아 Playwright로 분석한 결과 JSON을 반환합니다.
웹 화면, 회원, 세션, 장바구니, 주문, MySQL, Redis를 사용하지 않습니다.

## 실행

    docker compose up --build -d
    docker compose ps

### Codespaces에서 실행

    bash scripts/start-codespaces.sh

컨테이너를 시작하고 PHP 컨테이너의 현재 Docker 브리지를 자동으로 조회합니다.
Codespaces에서 확인된 legacy 방화벽 차단을 해결하기 위해 해당 브리지의
발신 통신과 응답 통신 허용 규칙을 `DOCKER-USER`에 추가합니다.
기존 규칙은 확인 후 건너뛰므로 반복 실행해도 중복 추가하지 않습니다.
방화벽 변경에는 `sudo` 권한이 필요하며, 기존 규칙이나 데이터는 삭제하지 않습니다.
기존 브리지의 오래된 규칙도 자동 삭제하지 않습니다.

워커가 준비되면 워커 내부에서 applemusic.co.kr DNS 조회를 확인합니다.
상품 분석 성공 여부는 별도로 API 요청으로 확인해야 합니다.
실패하면 원인을 출력하고 종료하며, 컨테이너와 이미 추가된 규칙은 유지합니다.
이 스크립트는 Linux Codespaces용이며 `iptables-legacy`와 `DOCKER-USER` 체인이
있어야 합니다. 도구 설치나 전체 방화벽 정책 변경은 수행하지 않습니다.

Codespaces 재시작 또는 네트워크 재생성 후에도 위 명령으로 시작하세요.
일반 `docker compose up`에는 이 처리가 자동 적용되지 않습니다.

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
