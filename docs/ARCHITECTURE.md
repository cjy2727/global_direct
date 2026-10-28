# API 아키텍처

외부 클라이언트 -> Nginx:80 -> PHP-FPM -> Playwright:3000 -> 상품 페이지.
public/index.php는 CORS, JSON 검증, 라우팅 및 오류 응답을 처리합니다.
src/ProductService.php는 URL 검증 후 worker 결과 전체를 반환합니다.
src/bootstrap.php는 클래스 로딩 및 환경 변수 조회만 담당합니다.

DB/Redis에 저장하지 않으며 세션 쿠키를 발급하지 않습니다.
반복 요청은 매번 분석합니다. worker 호출 제한 시간은 55초입니다.
화면, 회원, 장바구니, 주문 기능을 제거했습니다.
기존 MySQL/Redis 데이터 볼륨은 보존합니다. API 계약은 README.md를 참고하세요.
