# 상품 옵션 수집

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

## 검증

    docker compose exec -T playwright node tests/product-options.test.js
    docker compose exec -T playwright node tests/option-collection.test.js

로컬 fixture 검증이며 모든 실제 상점의 정확성을 보장하지 않습니다.
