<?php

declare(strict_types=1);

namespace App;

use RuntimeException;

final class RedisCache
{
    public function get(string $key): ?string
    {
        try {
            $response = $this->command(['GET', $key]);
            return is_string($response) ? $response : null;
        } catch (RuntimeException) {
            return null;
        }
    }

    public function set(string $key, string $value, int $ttlSeconds): void
    {
        try {
            $this->command(['SETEX', $key, (string) $ttlSeconds, $value]);
        } catch (RuntimeException) {
            // Cache failure must not prevent a customer from receiving a quote.
        }
    }

    private function command(array $parts): string|int|null
    {
        $host = \env_value('REDIS_HOST');
        $port = (int) \env_value('REDIS_PORT');
        $socket = @stream_socket_client("tcp://{$host}:{$port}", $errorCode, $errorMessage, 0.35);
        if ($socket === false) {
            throw new RuntimeException("Redis connection failed: {$errorCode}");
        }

        stream_set_timeout($socket, 0, 400000);
        $payload = '*' . count($parts) . "\r\n";
        foreach ($parts as $part) {
            $part = (string) $part;
            $payload .= '$' . strlen($part) . "\r\n{$part}\r\n";
        }
        fwrite($socket, $payload);
        $line = fgets($socket);
        if ($line === false) {
            fclose($socket);
            throw new RuntimeException('Redis returned no response.');
        }

        $type = $line[0];
        $value = rtrim(substr($line, 1), "\r\n");
        if ($type === '$') {
            $length = (int) $value;
            if ($length < 0) {
                fclose($socket);
                return null;
            }
            $body = '';
            while (strlen($body) < $length) {
                $chunk = fread($socket, $length - strlen($body));
                if ($chunk === false || $chunk === '') {
                    break;
                }
                $body .= $chunk;
            }
            fread($socket, 2);
            fclose($socket);
            return $body;
        }
        fclose($socket);
        if ($type === '-') {
            throw new RuntimeException('Redis command failed.');
        }
        if ($type === ':') {
            return (int) $value;
        }
        return $value;
    }
}
