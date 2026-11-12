# GlobalDirect URL Analysis API

상품 URL을 받아 기존 global_shopping 상품 API 또는 Playwright의 결과 JSON을 반환합니다.
상품 분석 API와 운영자 설정 화면을 제공합니다. 일반 사용자 회원·장바구니·주문·MySQL·Redis는 사용하지 않습니다. 운영자 인증 세션은 메모리에, 설정·인증정보·AI 사용량은 공개 경로 밖의 파일에 보존합니다.

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
- POST /api/products/jobs: 비동기 상품 분석 등록 (202)
- GET /api/products/jobs/{id}: 작업 상태·결과 조회
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
CORS는 브라우저 접근 제어이며 API 인증 기능은 아닙니다. 비동기 조회를 위해 GET도 허용합니다.

## AI와 공개 서비스 설정

`.env.example`의 환경변수는 초기값입니다. 운영자 페이지에 저장한 항목이 환경변수보다 우선하며, 키를 제외한 실제 적용값을 페이지에서 확인할 수 있습니다. 실제 키는 Git·브라우저·공개 로그에 넣지 않습니다. ChatGPT 구독 로그인 대신 별도 OpenAI API 키와 이용 가능한 크레딧이 필요합니다. 이 프로젝트는 구독 계정을 브라우저 자동화로 사용하지 않습니다.

    AI_ENABLED=true
    AI_PROVIDER=openai
    AI_MODEL=<API 프로젝트에서 사용 가능한 모델>
    AI_BASE_URL=https://api.openai.com/v1
    AI_API_KEY=<서버에만 보관할 키>
    AI_INPUT_USD_PER_MILLION=<해당 모델의 현재 입력 요금>
    AI_OUTPUT_USD_PER_MILLION=<해당 모델의 현재 출력 요금>

현재 OpenAI Responses API의 JSON Schema 출력을 지원하는 모델을 사용합니다. 모델은 자동 선택하지 않습니다. 제공업체 연결 모듈은 분리되어 있지만 `openai`만 구현되어 있으며 Claude는 추가 연결 구현이 필요합니다. 외부 호출은 HTTPS만 허용하고 리다이렉트를 따라가지 않습니다. 설정된 접속 주소로 자료와 키를 보내므로 신뢰하는 제공업체 주소만 지정합니다.

`AI_ENABLED=false`가 기본값입니다. 미사용 시 외부 AI 호출 없이 기존 수집과 옵션 입력 대체만 수행합니다. 처리 순서는 운영 Global Shopping API 우선 → 기존 Playwright 분석 → 부족 시 AI Chromium 탐색입니다. 내부 API 결과는 AI로 보완하지 않습니다. AI는 현재 페이지를 읽고 스크롤·상세 펼치기·옵션 선택·변경 대기를 결정하며, Chromium 실행 결과를 다시 받아 분석합니다. 텍스트 입력 옵션도 수집하고 명시된 가격·재고·필수 여부·비활성 상태를 전달합니다. 임의 코드 실행·입력값 채우기·장바구니·주문·결제·페이지 이동은 제공하지 않습니다. DOM 입력값·쿠키·헤더·스크립트는 AI 자료에서 제외합니다. 실제 이미지 내용/스크린샷 해석은 포함하지 않습니다.

운영자 페이지의 일반 설정은 저장 즉시 새 작업부터 적용하며 재시작하지 않습니다. 환경변수·관리자 접속 주소·저장 경로 등 시작 설정을 바꾸면 로컬에서는 `docker compose up -d`, 직접 설치 서버에서는 Node 프로세스 재시작이 필요합니다. 개발 시 소스는 읽기 전용 마운트로 반영됩니다. 운영 서버 직접 설치 방법은 [운영 안내](docs/OPERATIONS.md)를 참고하세요.

### 운영자 페이지

로컬 접속 주소는 **http://localhost:8080** 입니다. Docker 포트는 호스트의 `127.0.0.1`에만 공개합니다. 최초 한 번 아래 명령을 대화형 터미널에서 실행해 운영자 ID와 비밀번호(12자 이상)를 지정합니다.

    docker compose exec globaldirect node admin-setup.js

기본 비밀번호는 없으며 입력한 비밀번호는 표시·로그 출력하지 않습니다. 등록 후 페이지를 새로고침하고 로그인하세요. 이미 있는 인증 파일은 덮어쓰지 않습니다. 실제 `.env`와 기존 API 키는 수정하지 않습니다.

운영자 페이지에서 AI 설정·단가·운영 제한을 변경하고 실행/대기 작업, 오늘 호출 수·예상 비용, 최근 실패 사유와 변경 기록을 확인할 수 있습니다. API 키를 비워 저장하면 유지하고, 별도 삭제 체크박스로만 해제합니다. 키는 AES-256-GCM으로 저장하며 다시 표시하지 않습니다. 기존 환경변수 키는 해당 환경변수에 남아 있고, 관리 화면에서 입력한 새 키만 암호화 파일에 저장됩니다.

설정은 `/app/state/settings.json`, 인증정보와 암호화 키는 `/app/state/admin-auth.json`, AI 회계는 `/app/state/ai-usage.json`에 보존합니다. 세 파일은 공개 웹 경로 밖에 있으며 `analysis-state` 볼륨을 공유합니다. 인증 파일과 설정 파일을 함께 보호·백업해야 저장된 키를 복구할 수 있습니다. 파일 손상 시 초기화하거나 덮어쓰지 않습니다.

실행 중인 작업은 시작 당시 설정으로 완료하고 대기 작업은 실행 시작 때 최신 설정을 받습니다. 대기 만료 시간은 등록 당시 설정입니다. 동시 실행 수를 낮춰도 기존 작업을 강제 종료하지 않습니다. 설정 버전이 다르면 캐시와 진행 중 작업을 공유하지 않으며, 변경 전 작업의 결과를 새 설정의 캐시로 저장하지 않습니다. 설정 변경으로 사용량 집계는 초기화되지 않습니다.

| 설정 | 기본값 | 허용 범위 / 의미 |
| --- | --- | --- |
| `ANALYSIS_CONCURRENCY` | 1 | 1~16, 동시 Chromium 분석 수 |
| `ANALYSIS_TIMEOUT_SECONDS` | 60 | 5~120초, 분석 전체 실행 시간 |
| `QUEUE_MAX_LENGTH` | 20 | 0~10000, 최대 대기 작업 수 |
| `QUEUE_WAIT_TIMEOUT_SECONDS` | 30 | 1~120초, 최대 대기 시간 |
| `RATE_LIMIT_ENABLED` | true | true/false |
| `RATE_LIMIT_PER_IP_PER_MINUTE` | 10 | 1~10000, IP별 등록 요청 수 |
| `RATE_LIMIT_PER_USER_PER_MINUTE` | 10 | 1~10000, 서버 인증 사용자가 있을 때 추가 적용 |
| `CACHE_ENABLED` | true | true/false |
| `CACHE_TTL_SECONDS` | 300 | 1~86400초 |
| `JOB_RESULT_TTL_SECONDS` | 600 | 10~86400초, 완료·실패 작업 보관 |
| `RESULT_MAX_ENTRIES` | 500 | 1~10000, 작업·캐시 각각의 보관 상한 |
| `AI_MAX_OUTPUT_TOKENS` | 2000 | 256~16000 |
| `AI_CONCURRENCY` | 1 | 1~16, 초과 시 AI 생략 |
| `AI_TIMEOUT_SECONDS` | 20 | 1~120초, 전체 분석 시간 제한도 적용 |
| `AI_BROWSER_MAX_STEPS` | 8 | 1~30, 최종 결과 요청을 포함한 최대 모델 요청 수 |
| `AI_BROWSER_TIMEOUT_SECONDS` | 40 | 1~120초, AI 탐색 전체 시간. 기존 분석 전체 제한도 적용 |
| `AI_DAILY_REQUEST_LIMIT` | 100 | 0~1000000, 0이면 호출 생략 |
| `AI_DAILY_BUDGET` | 1 | 0~100000 USD, 0이면 호출 생략 |
| `AI_INPUT_USD_PER_MILLION` | 0 | 0~100000 USD, 모델별 입력 단가 |
| `AI_OUTPUT_USD_PER_MILLION` | 0 | 0~100000 USD, 모델별 출력 단가 |

요금이 0이거나 모델·키가 없으면 AI는 호출하지 않습니다. 요금은 자동 갱신되지 않으므로 모델 변경 시 함께 변경해야 합니다. 일일 한도는 UTC 00:00 기준입니다. AI 호출 전에 입력 바이트 수와 최대 출력 토큰으로 비용을 예약하고, 사용량 응답으로 조정합니다. 응답 실패·사용량 누락 시 예약액을 유지합니다. 실제 청구 상한을 보장하는 기능은 아니므로 제공업체의 사용량 제한도 함께 설정합니다.

AI 사용량은 `analysis-state` 볼륨에 보존합니다. 손상되거나 저장할 수 없으면 AI를 생략합니다. 대기열·캐시·작업·분당 카운터는 단일 프로세스 메모리이며 재시작하면 초기화됩니다. 여러 복제본 동시 운영은 지원하지 않습니다. IP는 PHP의 `REMOTE_ADDR`, 사용자 식별은 서버 인증의 `REMOTE_USER`만 사용하며 요청 본문의 사용자 ID는 신뢰하지 않습니다. 프록시의 실제 IP 설정은 운영 환경에 맞춰 구성해야 합니다.

공개 홈페이지는 다음 비동기 계약을 사용합니다.

    POST /api/products/jobs
    {"url":"https://shop.example.com/product/123"}
    → HTTP 202, {"ok":true,"job":{"id":"...","status":"queued"}}

    GET /api/products/jobs/{id}
    → {"ok":true,"job":{"id":"...","status":"queued|running|completed|failed",...}}

완료 작업에는 `job.product`, 실패 작업에는 `job.error`가 포함됩니다. 캐시·빠른 작업은 등록 응답부터 완료 상태일 수 있습니다. 2~3초 간격으로 조회하고 완료·실패 시 멈춥니다. 상태 조회 한도는 등록 한도의 30배/분으로 별도 적용됩니다. 작업 ID는 결과 접근 권한을 가진 비밀값이며 외부에 공유하지 않습니다. 조회가 없거나 만료되면 404입니다.

등록 요청 제한은 429, 대기열 포화·최대 대기 초과는 503, 동기 분석 시간 초과는 504입니다. 429/503 응답에는 `Retry-After: 60`이 포함됩니다. 비동기 작업 자체의 실패는 조회 응답의 `job.error`로 확인합니다. 캐시·중복 요청도 요청 제한에 포함됩니다. 동일 상품 판단은 fragment와 알려진 추적 파라미터만 제거하며 옵션·상품 식별 쿼리는 보존합니다.

결과의 `checkedAt`은 수집 완료 시각, `cacheAnalysis.hit`는 캐시 재사용 여부입니다. `aiAnalysis.status`는 `skipped`, `success`, `partial`, `failed`이며 `reason`으로 미사용·설정 누락·한도·제공업체 오류 등을 구분합니다. `mode=browser`, `steps`(모델 요청 수), `actions`(실행 도구), `proposed`·`accepted`·`rejected`(제안/채택/제외 사유)로 탐색 결과를 확인합니다. `success`는 분석 종료를 뜻하며 모든 정보의 채택을 의미하지 않습니다. AI가 보완한 옵션·상세는 관찰된 요소와 연결하지만 완전성 보장이 아니므로 `needs_review`입니다. 한 상품에서도 여러 번 모델을 호출할 수 있어 기존 1회 호출 방식보다 비용이 증가할 수 있습니다.

옵션 수집이 불완전하면 `optionFallback.status=manual_input`과 `optionFallback.fields`를 반환합니다. 각 필드의 `type=text`를 실제 input으로 표시하는 것은 호출 측의 역할입니다. `replacesGroupIds`에 지정된 기존 선택 항목과 대체 입력을 중복 요구하지 마세요. 입력 대체는 AI 미사용 시에도 적용되며, 미확인 추가금·재고를 확정하지 않습니다.

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

    docker compose exec -T globaldirect node /app/tests/ai-jobs.test.js
    docker compose exec -T globaldirect node /app/tests/admin.test.js
    docker compose exec -T globaldirect node /app/tests/ai-browser.test.js
    docker compose exec -T globaldirect node /app/tests/global-shopping.test.js
    docker compose exec -T globaldirect php /var/www/html/tests/AnalysisApiTest.php
    docker compose exec -T globaldirect node /app/tests/product-content.test.js
    docker compose exec -T globaldirect node /app/tests/product-options.test.js
    docker compose exec -T globaldirect node /app/tests/option-collection.test.js

네트워크 수집 테스트는 비식별 로컬 HTML/API fixture를 사용합니다. HTTP API 테스트는
로컬 worker 응답 fixture로 HTTP 계약을 검증합니다. 실제 상점 정확성 검증과 다릅니다.
`PRODUCT_WORKER_URL`은 `/analyze`를 포함하는 전체 내부 워커 URL입니다(기본값 `http://127.0.0.1:3000/analyze`).
build-and-export.bat는 PHP/Playwright/Nginx 이미지만 반출합니다.
