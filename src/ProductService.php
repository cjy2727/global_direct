<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class ProductService
{
    /** Return the worker result without storing products or job state. */
    public function analyze(string $url): array
    {
        $url = trim($url);
        $scheme = strtolower((string) parse_url($url, PHP_URL_SCHEME));
        if (strlen($url) > 2048 || !filter_var($url, FILTER_VALIDATE_URL) || !in_array($scheme, ['http', 'https'], true)) {
            throw new RuntimeException('올바른 상품 URL을 입력해 주세요.');
        }

        $endpoint = rtrim((string) env_value('PRODUCT_WORKER_URL'), '/') . '/analyze';
        $context = stream_context_create([
            'http' => [
                'method' => 'POST',
                'timeout' => 55,
                'ignore_errors' => true,
                'header' => "Content-Type: application/json\r\n"
                    . 'X-Worker-Token: ' . env_value('WORKER_TOKEN') . "\r\n",
                'content' => json_encode(['url' => $url], JSON_UNESCAPED_SLASHES),
            ],
        ]);
        $response = @file_get_contents($endpoint, false, $context);
        $payload = is_string($response) ? json_decode($response, true) : null;
        if (!is_array($payload) || ($payload['ok'] ?? false) !== true) {
            throw new RuntimeException((string) ($payload['message'] ?? '상품 페이지 분석 서버에 연결하지 못했습니다.'));
        }
        if (!is_array($payload['product'] ?? null) || array_is_list($payload['product'])) {
            throw new RuntimeException('상품 분석 서버의 응답 형식이 올바르지 않습니다.');
        }
        return $payload['product'];
    }
}
