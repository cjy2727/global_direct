# 스마트스토어: Windows Chrome과 Linux Chromium 접속 차이 진단

진단일: 2026-11-18 (Asia/Seoul)

대상: https://smartstore.naver.com/megaboxonline/products/13864833339

## 결론과 확정 범위

상품 상세가 실패하는 위치는 상품 파싱 이후가 아니라 네이버의 최초 문서 응답 단계다. 새 세션에서 첫 상품 요청에 HTTP 490과 보안 인증 화면을 받았으며, 다른 조건에서는 307 로그인 이동 또는 429를 받았다. 상품명·가격 수집 복구는 확인하지 못했다.

**Chromium 배포판만 차단된다는 설명은 실험 결과와 맞지 않는다.** Google 공식 Linux Chrome 158에서도 차단됐다. 헤드리스, 구버전, `navigator.webdriver`, 캐시, 언어 중 하나만 바꾸면 해결된다는 근거도 확보하지 못했다.

Windows에서 기존 Chrome 프로필로 접속하는 경우와 Linux의 새 브라우저 요청이 다르게 판정되는 것이 현재 가장 타당한 설명이다. 다만 기존 세션/쿠키, HTTP 요청 특성, OS/연결 특성, 서버 측 요청 이력 중 무엇이 결정 요인인지는 미확정이다. 네이버 내부 판정 규칙이나 점수를 관찰한 것은 아니다.

Windows Chrome 성공은 사용자가 확인해 준 사실이다. 이번 진단에서 Windows의 성공 요청을 직접 재현하거나 네트워크 응답을 캡처하지는 못했다. 따라서 Windows 성공과 Linux 실패를 같은 시점·동일 세션 조건으로 통제한 실험으로 해석하면 안 된다.

## 현재 환경

| 항목 | Windows | Linux 워커 |
| --- | --- | --- |
| 브라우저 | 설치 파일 버전 Chrome 157.0.8103.79 | Playwright Chromium 153.0.8010.12 |
| 세션 | 사용자가 사용하는 기존 프로필; 인증 상태 미확인 | 분석마다 `browser.newContext()`로 새 세션 |
| 화면 표시 | 사용자 일반 Chrome | 네이버에서는 `headless: false` |
| 언어 | 프로필 설정 `ko,en,th,gu,en-US` | 실제 런타임 `en-US` |
| 시간대 | 이번 진단에서는 브라우저 런타임 미확인 | 실제 런타임 `UTC` |
| 자동화 표시 | 이번 진단에서는 런타임 미확인 | `navigator.webdriver === true` |
| 요청 가로채기 | 사용자 브라우저 상태 미확인 | 전체 요청에 `page.route('**/*')` |

관련 코드: `worker/analyzer.js`의 `chromium.launch`, `browser.newContext`, `page.route`.

Windows PowerShell HTTP 클라이언트와 Linux Node HTTP 클라이언트의 외부 IPv4는 해시 비교 결과 같았다. Windows 시스템 프록시는 비활성화였고 확인한 Chrome 프로필에 별도 proxy mode 값은 없었다. 단, 이는 사용자 Chrome 자체의 실제 접속 IP, 확장 프로그램 프록시, IPv6, HTTP/3 경로까지 동일하다는 증거는 아니다. 원본 IP는 이 문서에 보관하지 않는다.

## 실제 상품 요청 비교

아래 Linux 실험은 개발용 Docker에서 실행했다. Linux 운영 서버 검증이 아니다. 인증 화면을 풀거나 로그인하지 않았으며 사용자 Windows 쿠키를 복사하지 않았다.

| 조건 | 결과 | 확인한 의미 |
| --- | --- | --- |
| 기존 워커 방식 | 307 → 네이버 로그인; 다른 재검증에서는 접근 제한 | 실패 재현 |
| Chromium 153, 새 세션, headed, 요청 가로채기 없음 | 첫 문서 490, 보안 인증 화면 | 요청 가로채기 제거만으로 복구되지 않음 |
| 공식 Chrome 158, 새 세션, headed, 요청 가로채기 없음, en-US/UTC | 첫 문서 490, 보안 인증 화면 | Google Chrome 브랜드·최신 버전 교체만으로 복구되지 않음 |
| 공식 Chrome 158, 새 세션, headed, 요청 가로채기 없음, ko-KR/Asia/Seoul | 첫 문서 490, 보안 인증 화면 | 한국어·서울 시간대 설정만으로 복구되지 않음 |
| 기존 별도 Linux Chromium, 일반 실행 + CDP 관찰, webdriver=false, ko/Asia/Seoul, 익명 프로필·캐시 유지 | 307 → 네이버 로그인 | webdriver=true만으로 설명할 수 없음 |
| 공식 Chrome 158, Playwright 런처 없이 일반 실행 + CDP 관찰, 새 프로필, webdriver=false, 요청 가로채기 없음 | 첫 문서 429 | Playwright 기본 실행 옵션 제거만으로 복구되지 않음 |

마지막 두 조건의 `webdriver=false`는 실제 런타임 측정값이다. 속성을 덮어쓰거나 자동화 표시를 숨기는 패치를 적용한 값이 아니다. CDP로 관찰했으므로 완전한 수동 조작 대조군이라고 표현하지 않는다. 기존 별도 Linux 프로필에는 네이버 쿠키가 12개 있었으나 로그인 쿠키 `NID_AUT`/`NID_SES`는 없었다. 쿠키 값은 출력·저장·전달하지 않았다.

두 새 세션의 영어 Chromium/공식 Chrome 비교에서 최초 상품 요청은 Cookie/Authorization 헤더가 없었고, 응답은 HTTP/2·TLS 1.3이었다. 디스크 캐시와 Service Worker 응답도 아니었다. 첫 문서 자체가 490이므로 이 실패를 상품 페이지 JavaScript 실행 실패나 DOM 추출 오류로 설명할 수 없다. 이후 인증 페이지 스크립트의 동작은 별개다.

HTTP 429 관찰만으로 과도한 호출 횟수가 단독 원인이라고 단정하지 않는다. 서로 다른 시점의 제한 응답 코드는 서버 상태·요청 이력의 영향도 받을 수 있다.

## 캐시 실험의 해석 보정

외부 요청 없이 로컬 HTTP fixture 서버로 실제 수신 헤더를 비교했다.

| Chromium 153 조건 | Cache-Control | Pragma |
| --- | --- | --- |
| 요청 가로채기 없음 | 없음 | 없음 |
| `page.route()` 후 `route.continue()` | `no-cache` | `no-cache` |
| 위 조건에서 추가 CDP 세션으로 `Network.setCacheDisabled(false)` 호출 | `no-cache` | `no-cache` |

따라서 Playwright 라우팅이 켜진 페이지에서 별도 CDP 세션의 캐시 활성화 호출이 성공했다는 사실만으로 일반 브라우저와 같은 캐시 동작이 복원됐다고 주장할 수 없다. 이번 fixture에서는 실제 헤더가 계속 달랐다. `Accept` 문서 헤더는 세 조건에서 같았다.

기존 `diagnose-browser.mjs`는 Playwright `page.route()` 실험과 달리 자신의 CDP 연결에서 Fetch/Network를 제어한다. 해당 경로와 위의 추가-CDP 실험을 동일시하지 않는다. 별도 Linux 진단의 일부 하위 리소스에서는 실제 디스크 캐시 사용도 관찰됐다.

요청 가로채기가 없는 비교에서도 상품 접근이 실패했으므로 캐시만을 전체 원인 또는 확정 해결책으로 결론 내릴 수는 없다.

## 남아 있는 확인 한계

- Windows UI 도구는 `Computer Use native pipe is unavailable`, 브라우저 도구는 `The browser access host is unavailable`을 반환했다. 기존 Windows 정상 탭의 응답·최종 URL·실제 상품명·가격을 이번 실행에서 재검증하지 못했다.
- Windows Chrome의 쿠키 DB는 값이 아닌 이름/개수만 읽는 읽기 전용 접근도 `unable to open database file`로 실패했다. 데이터베이스를 복사하거나 브라우저를 종료하지 않았다. Windows가 로그인된 상태라고 단정할 수 없다.
- Windows 성공 요청의 Cookie 존재 여부, HTTP/2·HTTP/3, 실제 네트워크 경로 및 확장 프로그램 영향은 미검증이다.
- Chrome을 Chromium으로 단순 교체하거나 Windows User-Agent를 설정하는 변경은 확인된 해결책이 아니다. 운영 수집의 Windows 의존성도 도입하지 않았다.

결정 요인을 더 분리하려면 Windows 정상 프로필과 별도의 새 프로필에서 같은 시점의 읽기 전용 접근 결과를 비교하고, 값이 제거된 요청/응답 메타데이터를 Linux 결과와 대조해야 한다. 성공 프로필과 새 프로필을 구분하는 실험이 세션 영향과 OS/브라우저 환경 영향을 분리하는 데 필요하다.

## 변경과 진단용 설치 범위

이번 후속 원인 조사에서는 서비스 소스·Compose·환경설정을 변경하지 않았다. 이 진단 문서만 추가했다. 이전 요청에서 수정된 오류 구분 코드는 그대로 유지한다. 서비스는 진단 종료 시 healthy였다.

비교용 공식 Chrome은 서비스 컨테이너의 `/tmp/naver-browser-comparison`에 패키지를 추출하여 사용했다. 시스템 패키지로 설치하거나 운영 이미지·브라우저 실행 경로를 변경하지 않았다. 비교용 브라우저 프로세스는 종료했다.

- 출처: https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
- 패키지: `google-chrome-stable`, `158.0.8127.36-1`, `amd64`
- 실행 버전: `Google Chrome 158.0.8127.36`
- 다운로드 SHA-256: `4696bce00b128f385a870ba2eb6eede61698f22374ea0d8e09af8a1c6543d397`

## 공식 참고 자료

- [Playwright 브라우저 지원](https://playwright.dev/docs/browsers): Chromium 기본 배포판과 Google Chrome 채널의 관계.
- [Playwright 격리 세션](https://playwright.dev/docs/browser-contexts): 새 context는 쿠키·스토리지를 공유하지 않는 시크릿 프로필에 가까운 환경.
- [Playwright Page.route](https://playwright.dev/docs/api/class-page#page-route): 라우팅 활성화 시 HTTP 캐시 비활성화.
- [Chrome User-Agent Client Hints](https://developer.chrome.com/docs/privacy-security/user-agent-client-hints): 브라우저 브랜드·버전·플랫폼 정보가 요청 헤더로 전달되는 구조. 네이버가 특정 헤더를 차단 기준으로 사용한다는 증거는 아님.
- [W3C WebDriver 인터페이스](https://www.w3.org/TR/webdriver2/#interface): `navigator.webdriver`의 의미. 네이버가 이를 결정 기준으로 사용한다는 증거는 아님.
