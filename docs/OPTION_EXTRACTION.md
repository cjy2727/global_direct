# 상품 옵션 수집

상품 수집의 기본 원칙은 [범용 상품 수집 정책](PRODUCT.md#범용-상품-수집-정책)을 따른다. 아래 수집 흐름과 직접 입력 대체는 현재 구현을 설명한다.

URL 분석 시 `worker/option-collector.js`가 다음 근거를 통합한다.

- 상품 영역의 select, radio, 명시적인 역할/속성을 가진 버튼·이미지 옵션, 기존 `optionlist[]` 입력 필드
- JSON 스크립트와 Next.js 스트리밍 상태에 포함된 현재 상품 데이터
- 브라우저가 받은 같은 출처의 상품/옵션 JSON 응답
- Shopify 변형 데이터, WooCommerce `data-product_variations`, Schema.org `hasVariant`

추천 상품·언어·통화·수량·결제 입력을 제외한다. 구조화 데이터는 URL/handle을 우선 대조하고 식별 URL이 없을 때만 상품명을 사용한다. 원본 JSON 응답, 쿠키, 인증 헤더, 고객 입력값은 상품 결과에 저장하지 않는다. 응답 개수/크기, 데이터 탐색 깊이, 옵션 및 조합 개수를 제한한다.

## 준비 상태와 연동 탐색

옵션 값과 로딩 상태가 안정될 때까지 최대 4.5초 관찰한다. 구조화 조합표가 없으면 필수 native select 2~5개를 최대 8초/80회 범위에서 탐색한다. select의 change 경로로 하위 옵션을 확인하며 탐색 중 POST 등 변경 요청, 페이지 이동, 장바구니/주문 관련 요청을 차단한다. 주문 버튼을 누르거나 폼을 제출하지 않는다.

이 제약 때문에 POST로만 하위 옵션을 조회하는 상점, 특수 버튼 연동, iframe/닫힌 Shadow DOM, 인증·자동화 차단, 긴 지연 로딩은 완전히 수집하지 못할 수 있다. WooCommerce의 빈 속성(모든 값에 대응하는 변형)과 500개를 넘는 구조화 조합은 추측해서 확장하지 않는다.

## API 결과

product.optionAnalysis 상태:
- complete: 지원 구조화 데이터로 옵션 조합과 재고 확인
- none: 사용자 선택 옵션이 없음을 확인
- partial: 전체 옵션/관계/재고 확인에 한계
- unresolved: 옵션 유무를 확인하지 못함

partial/unresolved는 상품 상태도 needs_review로 반환합니다.
product.optionGroups에 combinationGroupIds, combinations,
combinationsComplete 등 수집된 정보를 그대로 반환합니다.
결과는 저장하지 않으며 화면 표시와 이후 선택 검증은 호출 측에서 담당합니다.

## 옵션 직접 입력 대체 정책

옵션을 완전히 수집하지 못해도 확보한 상품 정보를 반환하고, `optionFallback.fields`에 텍스트 입력 항목 정의를 제공한다. 호출 측에서 이 정의를 입력 화면으로 표시해야 한다.

직접 입력 대체는 [AI 사용 설정](PRODUCT.md#ai-사용-설정-정책)과 독립적이다. `AI_ENABLED=false`이면 AI 호출·AI 기반 탐색만 건너뛰며, 기존 수집과 옵션 직접 입력 대체 규칙은 계속 적용한다.

- 옵션명만 확인되면 해당 이름의 텍스트 입력 항목으로 대체한다.
- 옵션 존재는 확인되지만 이름이나 구조를 확인하지 못하면 `옵션 직접 입력` 항목을 제공한다.
- 옵션 유무 자체가 불명확하면 `옵션·요청사항` 항목과 원본 상품 확인 안내를 제공한다. 옵션이 있다는 사실이나 필수 여부를 임의로 확정하지 않는다.
- 일부 옵션만 수집되었으면 확인된 선택 항목을 보존하고, 미확인 부분을 입력 항목으로 보완한다. 같은 옵션의 불완전한 선택지와 대체 입력란이 중복 선택을 요구하지 않도록 한다.
- 입력 항목으로 대체한 사실과 미확인 사유를 결과에 명시한다. 대체만으로 수집 성공으로 처리하지 않으며, `partial` 또는 `unresolved`와 상품의 `needs_review` 상태를 유지한다.
- 직접 입력할 옵션의 추가금·재고·유효 조합을 추측하지 않는다. 기본 상품가를 해당 옵션의 최종 확정가로 취급하지 않는다.
- 옵션이 없다는 근거가 있을 때만 `none`으로 처리한다. 확인된 옵션 없는 상품에 대체 입력 항목을 추가하지 않는다.
- 이 API는 입력 항목 정의만 반환한다. 실제 입력 화면과 이후 옵션·금액 확인은 호출 측에서 담당한다.

`optionFallback.status`는 `not_needed` 또는 `manual_input`이다. 각 입력 항목은 `id`, `name`, `type=text`, `required=false`, `source=manual_fallback`, `replacesGroupIds`, `placeholder`, `priceDelta=null`을 가진다. `replacesGroupIds`에 지정된 기존 그룹과 입력란을 동시에 요구하지 않는다. 아직 확인되지 않은 필수 여부를 강제하지 않는다. `priceConfirmed=false`, `stockConfirmed=false`와 안내 문구를 함께 반환한다.

## AI 브라우저 보완

기존 Playwright 분석이 불완전하고 AI가 활성화되면, AI는 현재 Chromium 페이지의 관찰 결과를 바탕으로 도구를 선택한다. 모델은 임의의 JavaScript나 CSS 선택자를 실행하지 않고 관찰된 요소 ID로 페이지 읽기·스크롤·상세 펼치기·옵션 선택·대기를 요청한다. 선택 후 바뀐 DOM을 다시 읽으므로 하위 옵션을 발견할 수 있다.

일반 select와 입력형 옵션, listbox/radiogroup의 이름·선택지·추가금·명시된 재고·필수/추가상품 여부·비활성 상태를 전달한다. AI가 선택한 옵션 ID를 관찰 결과와 대조하여 `source=ai_browser` 그룹으로 보완하며 텍스트 입력형은 선택지가 없어도 수집한다. 입력값 자체는 읽거나 채우지 않는다. 가격·재고가 속성에 없으면 추측하지 않는다.

기존 GET/HEAD 차단 규칙을 유지하고, AI 단계에서는 동일 출처 `/view/option`의 검증된 `checkoption1~3` 조회 POST만 예외로 허용한다. 알려지지 않은 POST 조회는 차단되어 미수집 상태로 남을 수 있다. 페이지 이동·장바구니·주문·결제 요청과 폼 제출은 허용하지 않는다. 동작은 상품 조회를 위한 임시 브라우저에서만 실행한다.

관찰한 선택 경로는 `observedPaths`로 남기며 서로 다른 경로의 선택지를 유효한 전체 조합으로 단정하지 않는다. AI 보완 옵션은 `partial`, 상품은 `needs_review`를 유지한다. 미확인 사항은 직접 입력 대체로 보완한다. `aiAnalysis`에 모델 요청 수·실행 동작·제안/채택 수·제외 사유·종료 이유를 반환하며 키·쿠키·원본 AI 응답은 반환하지 않는다.

## 검증

    docker compose exec -T globaldirect node /app/tests/product-options.test.js
    docker compose exec -T globaldirect node /app/tests/option-collection.test.js
    docker compose exec -T globaldirect node /app/tests/ai-jobs.test.js
    docker compose exec -T globaldirect node /app/tests/ai-browser.test.js

로컬 fixture 검증이며 모든 실제 상점의 정확성을 보장하지 않습니다.
