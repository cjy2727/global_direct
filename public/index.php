<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\ProductService;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// Allow browser requests only from the approved HTTPS storefront origins.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
$allowedOrigin = preg_match(
    '~^https://(?:(?:post|m2)\.[a-z0-9-]+\.shiptao\.kr|(?:post|m2)\.malltail\.com)$~i',
    $origin
) === 1;

header('Vary: Origin', false);
if ($allowedOrigin) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Access-Control-Expose-Headers: Retry-After');
}

if ($method === 'OPTIONS') {
    http_response_code($allowedOrigin ? 204 : 403);
    exit;
}

/** Send a JSON API response and finish the request. */
function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($path === '/health' && $method === 'GET') {
    json_response(['ok' => true, 'service' => 'globaldirect']);
}
$jobRoute = preg_match('~^/api/products/jobs/([a-f0-9]{48})$~', $path, $jobMatch) === 1;
if ($jobRoute) {
    header('Cache-Control: no-store');
    if ($method !== 'GET') { header('Allow: GET, OPTIONS'); json_response(['ok' => false, 'message' => 'GET 요청만 지원합니다.'], 405); }
    try { json_response((new ProductService())->job($jobMatch[1])); }
    catch (RuntimeException $exception) {
        $status = in_array($exception->getCode(), [400, 404, 429, 503, 504], true) ? $exception->getCode() : 422;
        if (in_array($status, [429, 503], true)) header('Retry-After: 60');
        json_response(['ok' => false, 'message' => $exception->getMessage()], $status);
    }
}
if (in_array($path, ['/api/products/analyze', '/api/products/jobs'], true)) {
    header('Cache-Control: no-store');
    if ($method !== 'POST') {
        header('Allow: POST, OPTIONS');
        json_response(['ok' => false, 'message' => 'POST 요청만 지원합니다.'], 405);
    }
    try {
        $input = json_decode((string) file_get_contents('php://input'), true, 512, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        json_response(['ok' => false, 'message' => '올바른 JSON 본문을 보내 주세요.'], 400);
    }
    if (!is_array($input) || !is_string($input['url'] ?? null)) {
        json_response(['ok' => false, 'message' => 'url 문자열이 필요합니다.'], 400);
    }
    try {
        $service = new ProductService();
        if ($path === '/api/products/jobs') json_response($service->submit($input['url']), 202);
        json_response(['ok' => true, 'product' => $service->analyze($input['url'])]);
    } catch (RuntimeException $exception) {
        $status = in_array($exception->getCode(), [400, 404, 429, 503, 504], true) ? $exception->getCode() : 422;
        if (in_array($status, [429, 503], true)) header('Retry-After: 60');
        json_response(['ok' => false, 'message' => $exception->getMessage()], $status);
    }
}
json_response(['ok' => false, 'message' => '경로를 찾을 수 없습니다.'], 404);
