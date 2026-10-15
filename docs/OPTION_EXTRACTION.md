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

## 결과와 기존 데이터 호환

`products.raw_json.optionAnalysis`에 다음 상태를 저장한다.

| 상태 | 의미 |
| --- | --- |
| complete | 지원하는 구조화 데이터로 옵션 조합과 재고 상태를 확인했고, 추가 선택 그룹이 남지 않음 |
| none | Shopify 단일 Default Title 변형으로 사용자 선택 옵션이 없음을 확인 |
| partial | 옵션은 있으나 전체 범위·관계·재고 확인에 한계가 있음 |
| unresolved | 옵션이 없는 것인지 수집하지 못한 것인지 확인할 수 없음 |

DOM만 읽은 결과는 전체 옵션의 존재 여부를 증명할 수 없으므로 보수적으로 partial로 둔다. partial/unresolved는 상품 분석 상태도 needs_review로 처리하고 상세/신청서에 안내한다. complete도 모든 상점의 정확성을 보장하는 판정은 아니다.

기존 v2 옵션 JSON에 `combinationGroupIds`, `combinations`, `combinationsComplete`를 추가한다. 조합표가 있으면 상세/신청서에서 선행 선택에 맞는 값만 활성화하고 서버에서도 조합과 품절을 재검증한다. 조합 추가금액은 한 번만 합산하며 알 수 없는 금액은 null로 유지한다. 구형 옵션 배열과 기존 입력형 옵션은 계속 지원한다.

DB 스키마와 기존 상품/주문을 변경하지 않는다. 기존에 분석해 저장한 상품에는 소급 적용되지 않으므로 같은 원본 URL을 다시 분석해야 새 결과를 확인할 수 있다.

## 검증

실제 주문/결제 없이 로컬 fixture와 연결 전용 MySQL 임시 테이블을 사용한다.

```powershell
docker compose exec -T playwright node tests/product-options.test.js
docker compose exec -T playwright node tests/option-collection.test.js
docker compose exec -T php php tests/ProductOptionsTest.php
docker compose exec -T php php tests/ProductOptionCombinationsTest.php
docker compose exec -T php php tests/ProductOptionStorageTest.php
docker compose exec -T php php tests/ProductOptionCombinationsTest.php --render | docker compose exec -T playwright node tests/option-combinations-ui.test.js
docker compose exec -T php php tests/ProductOptionsFlowTestPage.php | docker compose exec -T playwright node tests/option-flow.test.js
```

Shopify storefront 가격 단위 참고: https://shopify.dev/docs/api/liquid/objects/product#product-price
