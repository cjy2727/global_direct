# GlobalDirect URL Analysis API

상품 URL을 받아 기존 global_shopping 상품 API 또는 Playwright의 결과 JSON을 반환합니다.
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

product는 상품 조회 결과입니다. title, price, currency, sourceUrl, finalUrl,
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

Nginx -> PHP API -> Chromium -> 페이지 내 상품 API 응답 / 기존 페이지 분석.

플랫폼·운영 상점 사전 판별과 PHP의 직접 상품 API 호출은 사용하지 않습니다.
영문 Chromium(en-US)에서 페이지를 열기 전 네트워크 감시를 등록합니다.
global_shopping 위젯이 있으면 임시 브라우저에서 Allow Cookies를 누르고 새로고침한 뒤,
초기 요청 완료를 기다려 `detectedUIDExtend()`와 상품 조회 전용 `fetchProduct()`를 실행합니다.
장바구니 추가 버튼이나 주문·결제 기능은 실행하지 않습니다. 브라우저 컨텍스트는 요청 후 폐기합니다.

app.malltail.com 또는 app2.malltail.com의 `/global_shopping/api.php?a=product` 응답 중
현재 상품 UID와 일치하고 `status=success`인 데이터를 사용합니다.
개발서버 global_shopping 요청은 차단합니다. API 응답 원본은 `globalShopping.products`에
보존하며 기본 재고(`options.basic`)도 유지합니다. 선택 옵션은 `optionGroups`로 변환합니다.
정상 응답을 얻으면 페이지의 가격·이미지·옵션·상세설명은 추가 분석하지 않습니다.
빈 선택 옵션과 상세설명은 API의 빈 값 그대로 처리하며, 상세 HTML이 있으면 API HTML만 변환합니다.
조합별 상태를 확인하지 못한 옵션은 `optionAnalysis.status=partial`로 표시합니다.
상세설명이 비어 있다는 이유만으로 `needs_review`를 지정하지 않습니다.

위젯 준비·상품 응답 대기는 최대 12초입니다. API 응답이 없거나 실패하면 열린 페이지에서
기존 Playwright 분석을 수행합니다. 위젯이 없는 페이지는 짧은 발견 대기 후 기존 분석으로 진행합니다.
Worker의 URL 검사, 내부 네트워크 차단, 토큰 검증, 추출 로직은 유지합니다.
로그인 요구, 자동화 차단, 사이트 구조에 따라 정보가 누락될 수 있습니다.

    docker compose exec -T globaldirect node /app/tests/global-shopping.test.js
    docker compose exec -T globaldirect php /var/www/html/tests/AnalysisApiTest.php
    docker compose exec -T globaldirect node /app/tests/product-content.test.js
    docker compose exec -T globaldirect node /app/tests/product-options.test.js
    docker compose exec -T globaldirect node /app/tests/option-collection.test.js

네트워크 수집 테스트는 비식별 로컬 HTML/API fixture를 사용합니다. HTTP API 테스트는
로컬 worker 응답 fixture로 HTTP 계약을 검증합니다. 실제 상점 정확성 검증과 다릅니다.
`PRODUCT_WORKER_URL`은 `/analyze`를 포함하는 전체 내부 워커 URL입니다(기본값 `http://127.0.0.1:3000/analyze`).
build-and-export.bat는 PHP/Playwright/Nginx 이미지만 반출합니다.
