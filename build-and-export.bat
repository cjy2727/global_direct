@echo off
setlocal EnableExtensions

set "PROJECT_ROOT=%~dp0"
cd /d "%PROJECT_ROOT%" || (
  echo ERROR: Cannot open the project directory.
  exit /b 1
)

if not exist "VERSION" (
  echo ERROR: "VERSION" not found.
  exit /b 1
)

set /p "GLOBALDIRECT_VERSION=" < "VERSION"
echo(%GLOBALDIRECT_VERSION%| findstr /r /x "[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*" >nul || (
  echo ERROR: "VERSION" must contain a semantic version such as 1.0.1.
  exit /b 1
)

set "OUTPUT=globaldirect-images-%GLOBALDIRECT_VERSION%.tar"

docker version >nul 2>&1 || (
  echo ERROR: Docker is not installed or the Docker engine is not running.
  exit /b 1
)

docker compose version >nul 2>&1 || (
  echo ERROR: Docker Compose is not available.
  exit /b 1
)

if exist "%OUTPUT%" (
  echo ERROR: "%OUTPUT%" already exists.
  echo Move or delete the existing archive before exporting a new one.
  exit /b 1
)

echo [1/6] Validate Docker Compose configuration...
docker compose config --quiet || exit /b 1

echo [2/6] Build application images...
docker compose build php playwright || exit /b 1

echo [3/6] Pull runtime images...
docker pull nginx:1.27-alpine || exit /b 1

echo [4/6] Add version tags...
docker tag globaldirect-php:latest "globaldirect-php:%GLOBALDIRECT_VERSION%" || exit /b 1
docker tag globaldirect-playwright:latest "globaldirect-playwright:%GLOBALDIRECT_VERSION%" || exit /b 1

echo [5/6] Verify images...
docker image inspect ^
  globaldirect-php:latest ^
  "globaldirect-php:%GLOBALDIRECT_VERSION%" ^
  globaldirect-playwright:latest ^
  "globaldirect-playwright:%GLOBALDIRECT_VERSION%" ^
  nginx:1.27-alpine >nul || exit /b 1

echo [6/6] Export images to %OUTPUT%...
docker save -o "%OUTPUT%" ^
  globaldirect-php:latest ^
  "globaldirect-php:%GLOBALDIRECT_VERSION%" ^
  globaldirect-playwright:latest ^
  "globaldirect-playwright:%GLOBALDIRECT_VERSION%" ^
  nginx:1.27-alpine || exit /b 1

echo.
echo DONE: %OUTPUT%
exit /b 0
