<?php

declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

use App\Auth;
use App\CartService;
use App\OrderService;
use App\ProductService;

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('X-Content-Type-Options: nosniff');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function request_json(): array
{
    $data = json_decode((string) file_get_contents('php://input'), true);
    return is_array($data) ? $data : [];
}

function render(string $view, array $data = []): never
{
    extract($data, EXTR_SKIP);
    require dirname(__DIR__) . '/views/layout.php';
    exit;
}

if ($path === '/health') {
    json_response(['ok' => true, 'service' => 'globaldirect']);
}

if ($path === '/api/products/analyze' && $method === 'POST') {
    $input = request_json();
    try {
        $product = (new ProductService())->analyze((string) ($input['url'] ?? ''));
        json_response([
            'ok' => true,
            'product' => [
                'id' => $product['public_id'],
                'url' => '/products/' . $product['public_id'],
            ],
        ], 201);
    } catch (RuntimeException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 422);
    }
}

if (preg_match('#^/api/products/([a-f0-9]{16})$#', $path, $matches) && $method === 'GET') {
    try {
        json_response(['ok' => true, 'product' => (new ProductService())->find($matches[1])]);
    } catch (RuntimeException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 404);
    }
}

if ($path === '/api/cart/items' && $method === 'POST') {
    $input = request_json();
    try {
        $cart = (new CartService())->add(
            (string) ($input['product_id'] ?? ''),
            (int) ($input['quantity'] ?? 1),
            (array) ($input['selected_options'] ?? []),
            (string) ($input['request_note'] ?? '')
        );
        json_response(['ok' => true, 'cart' => $cart], 201);
    } catch (RuntimeException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 422);
    }
}

if ($path === '/api/cart' && $method === 'GET') {
    json_response(['ok' => true, 'items' => (new CartService())->items()]);
}

if ($path === '/api/register' && $method === 'POST') {
    $input = request_json();
    try {
        $user = (new Auth())->register(
            (string) ($input['email'] ?? ''),
            (string) ($input['password'] ?? ''),
            (string) ($input['name'] ?? '')
        );
        json_response(['ok' => true, 'user' => $user], 201);
    } catch (RuntimeException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 422);
    }
}

if ($path === '/api/login' && $method === 'POST') {
    $input = request_json();
    try {
        $user = (new Auth())->login(
            (string) ($input['email'] ?? ''),
            (string) ($input['password'] ?? '')
        );
        json_response(['ok' => true, 'user' => $user]);
    } catch (RuntimeException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 401);
    }
}

if ($path === '/api/logout' && $method === 'POST') {
    Auth::logout();
    json_response(['ok' => true]);
}
if ($path === '/api/session' && $method === 'GET') json_response(['ok' => true, 'user' => Auth::user()]);

if ($path === '/api/orders' && $method === 'POST') {
    $user = Auth::user();
    if ($user === null) json_response(['ok' => false, 'message' => '로그인이 필요합니다.'], 401);
    $input = request_json();
    try {
        json_response(['ok' => true, 'order' => (new OrderService())->createFromProduct($user, (string)($input['product_id'] ?? ''), $input)], 201);
    } catch (RuntimeException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 422);
    }
}

if ($path === '/api/orders/mine' && $method === 'GET') {
    $user = Auth::user();
    if ($user === null) json_response(['ok' => false, 'message' => '로그인이 필요합니다.'], 401);
    json_response(['ok' => true, 'orders' => (new OrderService())->mine((int) $user['id'])]);
}

if ($path === '/account') render('account', ['title' => '내 계정']);
if (preg_match('#^/products/([a-f0-9]{16})$#', $path, $matches)) {
    try {
        render('product', ['title' => '상품 상세', 'product' => (new ProductService())->find($matches[1])]);
    } catch (RuntimeException) {
        http_response_code(404);
        render('not-found', ['title' => '상품을 찾을 수 없습니다']);
    }
}
if ($path === '/request') {
    $productId = (string)($_GET['product'] ?? '');
    try {
        render('request', ['title' => '구매대행 신청', 'product' => (new ProductService())->find($productId)]);
    } catch (RuntimeException) {
        http_response_code(404);
        render('not-found', ['title' => '상품을 찾을 수 없습니다']);
    }
}
if ($path === '/cart') render('cart', ['title' => '장바구니']);
if ($path === '/orders') render('orders', ['title' => '주문 조회']);
if ($path === '/') render('home', ['title' => '전 세계 쇼핑을 더 가깝게']);

http_response_code(404);
render('not-found', ['title' => '페이지를 찾을 수 없습니다']);
