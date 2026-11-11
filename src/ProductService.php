<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class ProductService
{
    /** Browser network capture and page fallback both run in the worker. */
    public function analyze(string $url): array
    {
        $payload = $this->request('POST', '/analyze', ['url' => $this->validateUrl($url)]);
        if (!is_array($payload['product'] ?? null) || array_is_list($payload['product'])) {
            throw new RuntimeException('상품 분석 서버의 응답 형식이 올바르지 않습니다.');
        }
        return $payload['product'];
    }

    public function submit(string $url): array
    {
        return $this->request('POST', '/jobs', ['url' => $this->validateUrl($url)]);
    }

    public function job(string $id): array
    {
        return $this->request('GET', '/jobs/' . $id);
    }

    private function validateUrl(string $url): string
    {
        $url = trim($url);
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        $parts = parse_url($url);
        if (strlen($url) > 2048 || !filter_var($url, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)
            || isset($parts['user']) || isset($parts['pass']) || preg_match('/[\r\n]/', $url)) {
            throw new RuntimeException('올바른 상품 URL을 입력해 주세요.');
        }

        return $url;
    }

    private function request(string $method, string $path, ?array $input = null): array
    {
        $endpoint = preg_replace('~/analyze/?$~', '', env_value('PRODUCT_WORKER_URL', 'http://127.0.0.1:3000/analyze')) . $path;
        // Client headers cannot supply identity. REMOTE_USER is reserved for server authentication.
        $identity = preg_replace('/[\r\n]/', '', (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'));
        $user = preg_replace('/[\r\n]/', '', (string) ($_SERVER['REMOTE_USER'] ?? ''));
        $context = stream_context_create([
            'http' => [
                'method' => $method,
                'timeout' => 250,
                'ignore_errors' => true,
                'header' => "Content-Type: application/json\r\n"
                    . 'X-Worker-Token: ' . env_value('WORKER_TOKEN', 'local_worker_token_change_me') . "\r\n"
                    . 'X-Client-IP: ' . $identity . "\r\nX-Client-User: " . $user . "\r\n",
                'content' => $input === null ? '' : json_encode($input, JSON_UNESCAPED_SLASHES),
            ],
        ]);
        $response = @file_get_contents($endpoint, false, $context);
        $payload = is_string($response) ? json_decode($response, true) : null;
        if (!is_array($payload) || ($payload['ok'] ?? false) !== true) {
            $status = 422;
            if (isset($http_response_header[0]) && preg_match('~HTTP/\S+ (\d+)~', $http_response_header[0], $match)) {
                $candidate = (int) $match[1];
                if (in_array($candidate, [400, 404, 429, 503, 504], true)) $status = $candidate;
            }
            throw new RuntimeException((string) ($payload['message'] ?? '상품 페이지 분석 서버에 연결하지 못했습니다.'), $status);
        }
        return $payload;
    }
}
