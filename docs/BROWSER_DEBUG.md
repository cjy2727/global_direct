# Linux Chromium 직접 조작

Windows에서 Docker로 실행한 Linux Chromium을 브라우저 화면으로 직접 조작하는 진단 환경입니다.
수집기와 같은 Playwright `1.63.0-noble` 이미지에 포함된 Chromium을 사용합니다.
별도 Compose 프로젝트이며 기존 서비스·설정·데이터 볼륨은 연결하지 않습니다.

## 실행 및 접속

프로젝트 루트에서 실행합니다.

```powershell
docker compose -f compose.browser-debug.yml up --build -d
docker compose -f compose.browser-debug.yml ps
```

다음 주소를 Windows Chrome 또는 Edge에서 엽니다.

<http://localhost:6080/vnc.html?autoconnect=1&resize=scale>

마우스·키보드가 Linux Chromium에 전달됩니다. 주소창은 `Ctrl+L`, 개발자도구는
`Ctrl+Shift+I`로 엽니다. 쿠키는 개발자도구의 Application → Storage → Cookies에서
확인합니다. noVNC 왼쪽 제어판의 특수키 버튼도 사용할 수 있습니다.

단축키가 Windows 브라우저에서 처리되면 Linux 화면의 주소창을 마우스로 클릭하거나,
Linux Chromium의 ⋮ → More tools → Developer tools 메뉴를 사용하세요.
붙여넣기는 noVNC 왼쪽 제어판의 Clipboard 입력란을 사용할 수 있습니다.

### Windows ↔ Linux 텍스트 클립보드

1. Windows Chrome/Edge에서 위 `localhost` 주소로 접속합니다.
2. noVNC 왼쪽 Clipboard 패널에서 **클립보드 연결**을 누르고, 브라우저가 요청하면 접근을 허용합니다.
3. 원격 입력란을 클릭한 뒤 `Ctrl+V`로 Windows에서 복사한 텍스트를 붙여넣습니다.
4. 원격 화면에서 `Ctrl+C`로 복사하면 Windows 클립보드에도 전달됩니다.

자동 복사가 브라우저 권한·창 포커스 때문에 차단되면 패널의 **Windows로 복사**를 누르세요.
`Ctrl+Shift+V`와 `Shift+Insert`도 원격 텍스트 붙여넣기로 처리합니다.
이미지·파일은 공유하지 않습니다. 클립보드 내용은 로그·파일·웹 저장소에 저장하지 않습니다.
페이지를 새로고침하거나 원격 연결이 끊기면 공유는 꺼지며, **클립보드 연결**을 다시 눌러야 합니다.
기존 Clipboard 입력란도 계속 사용할 수 있습니다.

### 한글 입력

Linux에 Fcitx 5 한글 입력기(두벌식)가 실행됩니다. 원격 화면의 입력란을 클릭한 뒤
`Ctrl+Space`로 한글/영문을 전환하세요. 한/영 키도 등록되어 있지만 Windows에서 먼저
처리될 수 있으므로 `Ctrl+Space`를 권장합니다. Windows 쪽 입력 상태는 영문으로 두고
Linux 쪽에서 전환하면 두 입력기가 동시에 조합하는 것을 피할 수 있습니다.

처음에는 빈 탭이 열립니다. 판매자센터나 상품 URL을 주소창에 직접 입력해 비교하세요.
로그인이나 보안 인증은 자동으로 수행하지 않습니다.

## 프로필과 재시작

쿠키·사이트 저장소·브라우저 캐시는 전용 `browser-profile` 볼륨에 보존됩니다.
Chromium 창을 모두 닫으면 새 창이 자동으로 실행되며 같은 프로필을 사용합니다.
쿠키 전체 삭제는 해당 진단 Chromium의 개발자도구에서 직접 수행하세요.
Windows 브라우저의 프로필은 공유하지 않습니다.

```powershell
# 진단 환경 중지: 프로필 보존
docker compose -f compose.browser-debug.yml stop

# 다시 실행: 기존 프로필 재사용
docker compose -f compose.browser-debug.yml up -d

# 상태와 로그
docker compose -f compose.browser-debug.yml ps
docker compose -f compose.browser-debug.yml logs --tail 30
```

## 진단 조건

### 익명 세션을 유지하는 상품 접근 진단

```powershell
docker compose -f compose.browser-debug.yml up -d
docker compose -f compose.browser-debug.yml exec -T browser-debug node /opt/product-diagnostics/diagnose-browser.mjs 'https://smartstore.naver.com/choicemallplus/products/13774570720'
# 상품 문서에만 Windows 비교용 Accept 적용 (하위 스크립트/API에는 적용하지 않음)
docker compose -f compose.browser-debug.yml exec -T browser-debug node /opt/product-diagnostics/diagnose-browser.mjs 'https://smartstore.naver.com/choicemallplus/products/13774570720' --document-accept
```

기존 Linux Chromium의 프로필·익명 쿠키·캐시를 재사용하고 자체 진단 탭만 종료합니다.
`NID_AUT`/`NID_SES`가 있으면 탐색 전에 중단하며 로그인·보안 인증은 수행하지 않습니다.
공개 URL 검사와 GET/HEAD 제한을 유지하면서 CDP로 캐시 사용을 명시합니다.
사이트 접속으로 갱신되는 익명 쿠키·캐시는 기존 프로필에 남습니다.
동일 세션을 사용하므로 두 명령의 결과만으로 헤더의 단독 인과관계를 확정하지 않습니다.
쿠키 값·인증 헤더·원본 HTML은 출력하거나 별도 파일에 저장하지 않습니다.
응답·리다이렉트와 1/4/12초의 상품명·가격 표시를 JSON으로 출력합니다.
상품 데이터만 있고 화면 확인이 부족하면 `needs_review`이며 성공으로 처리하지 않습니다.
종료 코드는 상세 표시 성공 0, 접근 실패/불완전 2, 진단 실행 오류 1입니다.
이 경로는 진단 전용이며 `/api/products/analyze`의 실행 구조를 변경하지 않습니다.
진단 스크립트와 기존 URL 검사 모듈 두 파일만 컨테이너에 읽기 전용으로 연결합니다.

- Chromium은 일반 실행 방식이며 Playwright 분석 요청과 연결되지 않습니다.
- Playwright 기본 실행 옵션, 매 요청의 새 컨텍스트, 요청 가로채기와는 조건이 다릅니다.
- 시간대는 Asia/Seoul, 화면은 1440×1000입니다. 한국어 폰트를 설치합니다.
- GUI 구성요소는 Ubuntu Noble 공식 저장소의 배포 패키지를 사용합니다.
- 호스트에는 `127.0.0.1:6080`만 공개합니다. VNC 5900은 컨테이너 내부 loopback에만 열립니다.
- 네트워크 진단용 CDP 9222도 컨테이너 내부 loopback에서만 열며 호스트에는 공개하지 않습니다.
- 로컬 전용 환경이므로 VNC 암호는 사용하지 않습니다. 외부 공개용 구성이 아닙니다.
- 컨테이너 호환성을 위해 Chromium은 `--no-sandbox`로 실행됩니다. 전용 비root 사용자로 실행하며,
  위 진단 코드 두 파일 외의 프로젝트 파일이나 기존 서비스의 인증정보·설정을 마운트하지 않습니다.
- 이 환경의 상품 접근 성공이 분석 API나 운영 Linux 서버의 수집 복구를 뜻하지는 않습니다.
