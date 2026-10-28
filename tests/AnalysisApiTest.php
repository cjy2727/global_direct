<?php
declare(strict_types=1);

/** Verify the public API against a local HTTP worker fixture without databases. */
function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}

/** Reserve an available loopback port for a temporary test server. */
function free_port(): int
{
    $socket = stream_socket_server('tcp://127.0.0.1:0', $errno, $error);
    if (!$socket) throw new RuntimeException($error);
    $port = (int) substr(strrchr(stream_socket_get_name($socket, false), ':'), 1);
    fclose($socket);
    return $port;
}

/** Perform an HTTP request and retain status, JSON and headers. */
function request_api(int $port, string $path, string $method = 'GET', string $body = '', string $origin = ''): array
{
    $headers = "Content-Type: application/json\r\n";
    if ($origin !== '') $headers .= 'Origin: ' . $origin . "\r\n";
    if ($method === 'OPTIONS') $headers .= "Access-Control-Request-Method: POST\r\nAccess-Control-Request-Headers: content-type\r\n";
    $result = file_get_contents('http://127.0.0.1:' . $port . $path, false, stream_context_create([
        'http' => ['method' => $method, 'header' => $headers, 'content' => $body, 'ignore_errors' => true, 'timeout' => 5],
    ]));
    preg_match('~HTTP/\S+ (\d+)~', $http_response_header[0], $matches);
    return [(int) $matches[1], json_decode((string) $result, true), implode("\n", $http_response_header)];
}

$temp = sys_get_temp_dir() . '/globaldirect-api-test-' . bin2hex(random_bytes(6));
mkdir($temp);
$processes = [];
try {
    $workerPort = free_port();
    $apiPort = free_port();
    while ($apiPort === $workerPort) $apiPort = free_port();
    $fixture = ['title' => 'Fixture product', 'price' => null, 'currency' => 'USD',
        'sourceUrl' => 'https://shop.example.test/item', 'images' => ['https://shop.example.test/a.jpg'],
        'optionGroups' => [['name' => 'Size', 'values' => [['label' => 'M', 'disabled' => true]]]],
        'optionAnalysis' => ['status' => 'partial'], 'content' => ['blocks' => [['type' => 'text', 'text' => 'Detail']]],
        'status' => 'needs_review'];
    file_put_contents($temp . '/payload.json', json_encode(['ok' => true, 'product' => $fixture]));
    file_put_contents($temp . '/worker.php', <<<'PHP'
<?php
header('Content-Type: application/json');
$input = json_decode(file_get_contents('php://input'), true);
if ($_SERVER['REQUEST_METHOD'] !== 'POST' || $_SERVER['REQUEST_URI'] !== '/analyze'
    || ($_SERVER['HTTP_X_WORKER_TOKEN'] ?? '') !== 'fixture-only-token'
    || ($input['url'] ?? '') !== 'https://shop.example.test/item') {
    http_response_code(422);
    echo json_encode(['ok' => false, 'message' => 'Worker request contract mismatch']);
    exit;
}
echo file_get_contents(__DIR__ . '/payload.json');
PHP);
    putenv('PRODUCT_WORKER_URL=http://127.0.0.1:' . $workerPort);
    putenv('WORKER_TOKEN=fixture-only-token');
    foreach ([[$workerPort, $temp . '/worker.php'], [$apiPort, dirname(__DIR__) . '/public/index.php']] as [$port, $router]) {
        $process = proc_open([PHP_BINARY, '-S', '127.0.0.1:' . $port, $router],
            [0 => ['file', '/dev/null', 'r'], 1 => ['file', $temp . '/server.log', 'a'], 2 => ['file', $temp . '/server.log', 'a']], $pipes);
        check(is_resource($process), 'Server did not start');
        $processes[] = $process;
        $ready = false;
        for ($i = 0; $i < 50; $i++) {
            $connection = @fsockopen('127.0.0.1', $port, $errno, $error, 0.1);
            if ($connection) { fclose($connection); $ready = true; break; }
            usleep(100000);
        }
        check($ready, 'Server not ready');
    }
    $path = '/api/products/analyze';
    [$status, $data, $headers] = request_api($apiPort, $path, 'POST', json_encode(['url' => '  https://shop.example.test/item  ']), 'https://post.malltail.com');
    check($status === 200 && $data === ['ok' => true, 'product' => $fixture], 'Full product payload was not preserved');
    check(!str_contains(strtolower($headers), 'set-cookie:'), 'Unexpected session cookie');
    check(str_contains($headers, 'Access-Control-Allow-Origin: https://post.malltail.com'), 'Missing success CORS header');
    foreach (['{}', '{', '{"url":[]}', 'null'] as $body) {
        check(request_api($apiPort, $path, 'POST', $body)[0] === 400, 'Malformed JSON/field handling');
    }
    foreach (['', 'file:///etc/passwd', 'not-a-url'] as $url) {
        check(request_api($apiPort, $path, 'POST', json_encode(['url' => $url]))[0] === 422, 'Invalid URL handling');
    }
    check(request_api($apiPort, $path)[0] === 405, 'Wrong method handling');
    foreach (['/', '/cart', '/account', '/orders', '/api/cart', '/api/session', '/products/0123456789abcdef', '/request-ai'] as $route) {
        [$status, $data] = request_api($apiPort, $route);
        check($status === 404 && $data['ok'] === false, 'Legacy route remains: ' . $route);
    }
    foreach (['https://post.dev.shiptao.kr', 'https://m2.jycha.shiptao.kr', 'https://post.malltail.com', 'https://m2.malltail.com'] as $origin) {
        [$status, , $headers] = request_api($apiPort, $path, 'OPTIONS', '', $origin);
        check($status === 204 && str_contains($headers, 'Access-Control-Allow-Origin: ' . $origin), 'Allowed origin rejected');
    }
    foreach (['http://post.malltail.com', 'https://post.a.b.shiptao.kr', 'https://post.malltail.com.evil.test'] as $origin) {
        [$status, , $headers] = request_api($apiPort, $path, 'OPTIONS', '', $origin);
        check($status === 403 && !str_contains($headers, 'Access-Control-Allow-Origin:'), 'Unapproved origin allowed');
    }
    foreach (['not-json', '{"ok":true}', '{"ok":true,"product":[]}', '{"ok":false,"message":"fixture failure"}'] as $payload) {
        file_put_contents($temp . '/payload.json', $payload);
        [$status, $data, $headers] = request_api($apiPort, $path, 'POST', '{"url":"https://shop.example.test/item"}', 'https://m2.malltail.com');
        check($status === 422 && $data['ok'] === false, 'Worker failure handling');
        check(str_contains($headers, 'Access-Control-Allow-Origin: https://m2.malltail.com'), 'Missing failure CORS header');
    }
    check(request_api($apiPort, '/health')[0] === 200, 'Health failed');
    echo "PASS: API full result, worker HTTP contract, validation, removed routes, CORS, no session, worker errors.\n";
} finally {
    foreach ($processes as $process) { proc_terminate($process); proc_close($process); }
    foreach (glob($temp . '/*') as $file) unlink($file);
    rmdir($temp);
}
