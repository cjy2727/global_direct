# 운영자 설정 및 서버 직접 설치

Docker Compose는 로컬 개발용이다. 운영 서버에서는 Nginx·PHP-FPM·Node·Playwright Chromium을 직접 구성하고 동일한 Node 워커를 실행한다. 아래는 설치 구성 예시이며 실제 운영 서버에서 실행·검증한 결과는 아니다. 현재 개발 이미지의 PHP는 8.3, Playwright는 `worker/package.json`의 고정 버전이다. Node는 `--env-file`을 지원하는 버전을 사용한다.

## 최초 설정

워커 실행 계정만 읽고 쓸 수 있는 공개 웹 경로 밖의 디렉터리(예: `/var/lib/globaldirect`)를 준비한다. 이 문서의 경로와 계정은 서버 환경에 맞춰 지정한다.

환경 파일에 다음 시작 설정을 지정한다. 환경 파일은 Nginx의 공개 document root 밖에 보관하고 워커 계정만 읽도록 한다.

```dotenv
AI_USAGE_FILE=/var/lib/globaldirect/ai-usage.json
SETTINGS_FILE=/var/lib/globaldirect/settings.json
ADMIN_AUTH_FILE=/var/lib/globaldirect/admin-auth.json
ADMIN_PUBLIC_ORIGIN=https://admin.example.com
WORKER_TOKEN=<서버에서 생성한 공유 토큰>
```

관리 화면의 HTTPS 접속 주소는 실제 운영 주소로 변경한다. 로컬 개발은 `http://localhost:8080`이다. PHP의 `WORKER_TOKEN`과 `PRODUCT_WORKER_URL=http://127.0.0.1:3000/analyze`도 PHP-FPM이 읽을 수 있게 구성해야 한다. PHP-FPM의 환경변수 전달 설정을 서버에 맞게 확인한다.

Playwright 의존성과 해당 버전의 Chromium·OS 의존성이 설치되어 있어야 한다. 신규 설치 명령은 서버 관리자에게 필요한 패키지와 영향을 확인한 뒤 실행한다. 기존 프로젝트 의존성 설치는 `worker` 폴더에서 `npm install --omit=dev`, 브라우저 준비는 `npx playwright install --with-deps chromium`을 사용한다. 설치 후 워커 실행 계정으로 Chromium 실행 권한과 `PLAYWRIGHT_BROWSERS_PATH`를 확인한다. 이 작업은 로컬 Docker 빌드와 별개의 운영 서버 작업이다.

프로젝트 루트에서 운영자 계정을 등록한다. 비밀번호는 12자 이상이며 터미널에 표시되지 않는다.

```sh
node --env-file=/etc/globaldirect.env worker/admin-setup.js
```

기존 인증 파일이 있으면 등록을 거절한다. 계정 복구 시 파일을 삭제하거나 덮어쓰지 말고 먼저 설정·인증 파일을 보존하고 복구 절차를 결정한다. 인증 파일에는 암호화 키도 있으므로 없애면 저장한 API 키를 해독하지 못할 수 있다.

워커 실행 예시:

```sh
node --env-file=/etc/globaldirect.env worker/server.js
```

systemd 등 서버의 프로세스 관리자를 사용해 워커를 한 개만 실행한다. 운영에서는 개발용 `node --watch`를 사용하지 않는다. API는 3000, 운영자 내부 서버는 loopback 3001을 사용하므로 방화벽에서 외부 직접 접근을 허용하지 않는다. Nginx 공개 상품 API는 PHP-FPM으로, 운영자 전용 호스트는 아래와 같이 3001로 프록시한다.

```nginx
# 운영자 전용 HTTPS server 블록 내부 예시
# listen 443 ssl / 인증서 / server_name은 운영 환경에 맞게 구성한다.
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $http_host;
    proxy_set_header X-Admin-Client-IP $remote_addr;
    proxy_set_header X-Forwarded-For "";
    proxy_set_header X-Forwarded-Proto "";
}
```

운영자 호스트에는 관리자 IP/VPN 접근 제한을 함께 적용한다. 개발용 HTTP 8080 구성을 그대로 인터넷에 노출하지 않는다. SSH 터널로만 사용할 경우 Nginx 8080을 loopback에 바인딩하고 실제 브라우저 접속 주소를 `ADMIN_PUBLIC_ORIGIN`에 지정할 수 있다. Nginx 리스너·TLS·접근 제한 변경은 별도 reload가 필요하지만 일반 AI·운영 한도 변경은 필요 없다.

## 로컬 Docker

```sh
docker compose up --build -d
docker compose exec globaldirect node admin-setup.js
```

등록 후 `http://localhost:8080`에서 로그인한다. `127.0.0.1:8080` 대신 설정된 정확한 `localhost` 주소로 접속한다. 관리 포트는 호스트 loopback에만 공개된다. 기본 비밀번호는 없으며 기존 `.env`와 키는 수정하지 않는다.

## 적용 및 보존

- 환경변수는 초기값, 관리 화면에 저장한 항목이 우선이다. `.env`를 직접 수정해도 저장된 같은 항목을 덮어쓰지 않는다.
- 저장은 형식·범위·필수 항목을 검증하고 현재 버전을 확인한 뒤 적용한다. 다른 운영 창에서 변경되면 새로고침 후 다시 저장한다.
- API 키 빈 입력은 유지, 삭제 체크는 해제다. 기존 환경변수 키를 해제해도 `.env` 자체를 삭제하지 않으며 저장된 해제 설정을 우선한다. 새 키만 암호화 파일에 기록한다.
- 실행 중 작업은 기존 설정, 대기 작업은 실행 시작 시 최신 설정을 사용한다. 대기 제한 시간은 등록 당시 값이다. 이미 실행한 AI 비용은 설정 변경으로 초기화하지 않는다.
- 설정 버전이 다른 캐시와 진행 중 작업은 공유하지 않는다. 버전이 바뀌는 동안 완료된 이전 작업 결과는 새 설정 캐시로 저장하지 않는다.
- 설정·인증·사용량 파일은 워커 계정만 접근하도록 유지하고 함께 백업한다. 파일 손상·암호화 키 누락 시 자동 초기화하지 않는다.
- 계정 정보·저장 경로·접속 Origin·환경 기본값 변경은 워커 재시작이 필요하다. 일반 운영 설정은 화면 저장 즉시 적용한다. 설정 파일을 외부 편집하는 실시간 반영은 지원하지 않는다.
- 여전히 단일 워커 구조다. 여러 프로세스/서버 운영은 공유 설정·회계·작업 저장소를 도입한 뒤 별도 검증해야 한다.

## 검증

로컬 fixture에서 인증·CSRF·Origin·로그인 제한·암호화·설정 충돌·저장 실패·작업별 설정 적용·캐시 분리 및 Chromium 화면 저장을 검사한다. 실제 운영 서버 검증이나 유료 AI 호출 검증을 의미하지 않는다.

```sh
docker compose exec -T globaldirect node /app/tests/admin.test.js
```
