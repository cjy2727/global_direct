<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\Database;
use App\OrderWorkflow;
use App\QuoteCalculator;
use App\RedisCache;

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

if ($path === '/api/quote' && $method === 'POST') {
    $input = request_json();
    try {
        $url = (string) ($input['url'] ?? '');
        $quantity = (int) ($input['quantity'] ?? 1);
        $cache = new RedisCache();
        $cacheKey = 'globaldirect:quote:' . hash('sha256', $url . '|' . $quantity);
        $cached = $cache->get($cacheKey);
        $estimate = $cached === null ? (new QuoteCalculator())->calculate($url, $quantity) : json_decode($cached, true);
        if ($cached === null) {
            $cache->set($cacheKey, json_encode($estimate, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), 900);
        }
        json_response(['ok' => true, 'estimate' => $estimate, 'cache' => $cached === null ? 'miss' : 'hit']);
    } catch (InvalidArgumentException $exception) {
        json_response(['ok' => false, 'message' => $exception->getMessage()], 422);
    }
}

if ($path === '/api/orders' && $method === 'GET') {
    $orders = Database::connection()->query('SELECT order_no, customer_name, status, total_jpy, product_name, created_at FROM orders ORDER BY created_at DESC LIMIT 100')->fetchAll();
    foreach ($orders as &$order) {
        $order['next_statuses'] = OrderWorkflow::nextStatuses($order['status']);
    }
    json_response(['ok' => true, 'orders' => $orders]);
}

if (preg_match('#^/api/orders/([^/]+)/status$#', $path, $matches) && $method === 'POST') {
    $input = request_json();
    if (!hash_equals(csrf_token(), (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
        json_response(['ok' => false, 'message' => '요청 인증값이 올바르지 않습니다.'], 419);
    }

    $pdo = Database::connection();
    $query = $pdo->prepare('SELECT id, status FROM orders WHERE order_no = ?');
    $query->execute([$matches[1]]);
    $order = $query->fetch();
    $next = (string) ($input['status'] ?? '');
    if (!$order || !OrderWorkflow::canTransition($order['status'], $next)) {
        json_response(['ok' => false, 'message' => '허용되지 않은 상태 변경입니다.'], 422);
    }

    $pdo->beginTransaction();
    $update = $pdo->prepare('UPDATE orders SET status = ? WHERE id = ?');
    $update->execute([$next, $order['id']]);
    $history = $pdo->prepare('INSERT INTO order_status_history (order_id, from_status, to_status, note) VALUES (?, ?, ?, ?)');
    $history->execute([$order['id'], $order['status'], $next, '관리자 데모 화면에서 변경']);
    $pdo->commit();
    json_response(['ok' => true, 'status' => $next]);
}

if ($path === '/admin') {
    render('admin', ['title' => '운영 대시보드']);
}

if ($path === '/orders') {
    render('orders', ['title' => '주문 조회']);
}

if ($path === '/') {
    render('home', ['title' => '한국 쇼핑을 더 가깝게']);
}

http_response_code(404);
render('not-found', ['title' => '페이지를 찾을 수 없습니다']);
