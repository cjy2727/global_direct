FROM mcr.microsoft.com/playwright:v1.63.0-noble

ENV DEBIAN_FRONTEND=noninteractive
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Nginx, PHP 8.3, Supervisor 설치
RUN apt-get update && apt-get install -y \
    nginx \
    php8.3-fpm \
    php8.3-cli \
    php8.3-curl \
    php8.3-mbstring \
    php8.3-xml \
    php8.3-mysql \
    php8.3-zip \
    supervisor \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# PHP-FPM 실행 디렉터리
RUN mkdir -p /run/php /var/log/supervisor

# PHP-FPM을 TCP 9000으로 실행
RUN sed -i \
    's|^listen = .*|listen = 127.0.0.1:9000|' \
    /etc/php/8.3/fpm/pool.d/www.conf

# Nginx 기본 설정 제거
RUN rm -f /etc/nginx/sites-enabled/default \
    /etc/nginx/conf.d/default.conf

# 애플리케이션 디렉터리
RUN mkdir -p /var/www/html/public \
    /var/www/html/src \
    /var/www/html/tests \
    /app

# PHP 코드
COPY public/ /var/www/html/public/
COPY src/ /var/www/html/src/
COPY tests/ /var/www/html/tests/

# Nginx 설정
COPY nginx/default.conf /etc/nginx/conf.d/default.conf

# Node.js 의존성
WORKDIR /app

COPY worker/package*.json ./
RUN npm ci --omit=dev

# Playwright 코드
COPY worker/ ./

# Supervisor 설정
COPY docker/supervisord.conf /etc/supervisor/conf.d/supervisord.conf

EXPOSE 80

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/conf.d/supervisord.conf"]