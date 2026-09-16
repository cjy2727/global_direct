<?php

declare(strict_types=1);
namespace App;

/** 저장된 수집 결과를 실행 가능한 HTML이 없는 상세설명 블록으로 정규화한다. */
final class ProductContent
{
    /** 표시 가능한 HTTP(S) 이미지 주소만 허용한다. */
    public static function imageUrl(mixed $value): ?string
    {
        if (!is_string($value) || strlen($value) > 2048 || !filter_var($value, FILTER_VALIDATE_URL)) return null;
        $url = parse_url($value);
        if (!in_array(strtolower($url['scheme'] ?? ''), ['http', 'https'], true) || isset($url['user']) || isset($url['pass'])) return null;
        $host = strtolower(trim($url['host'] ?? '', '[]'));
        if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local')) return null;
        if (filter_var($host, FILTER_VALIDATE_IP) && !filter_var($host, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) return null;
        return $value;
    }

    /** 허용된 블록 종류만 반환하며 이전 상품에는 기존 설명을 사용한다. */
    public static function details(array $snapshot, ?string $legacyDescription): array
    {
        $blocks = [];
        $textLength = 0;
        $images = [];
        $candidates = $snapshot['content']['blocks'] ?? [];
        if (!is_array($candidates)) $candidates = [];
        foreach (array_slice($candidates, 0, 120) as $block) {
            if (!is_array($block)) continue;
            $type = $block['type'] ?? '';
            if ($type === 'image') {
                $url = self::imageUrl($block['url'] ?? null);
                if ($url !== null && !in_array($url, $images, true) && count($images) < 24) {
                    $blocks[] = ['type' => 'image', 'url' => $url, 'alt' => self::text($block['alt'] ?? '', 200)];
                    $images[] = $url;
                }
            } elseif (in_array($type, ['text', 'heading', 'specification'], true) && $textLength < 20000) {
                $text = self::text($block['text'] ?? '', min(4000, 20000 - $textLength));
                if ($text === '') continue;
                $blocks[] = ['type' => $type, 'text' => $text, 'name' => self::text($block['name'] ?? '', 200)];
                $textLength += strlen($text);
            }
        }
        if (!$blocks && $legacyDescription) {
            $text = self::text($legacyDescription, 20000);
            if ($text !== '') $blocks[] = ['type' => 'text', 'text' => $text];
        }
        return $blocks;
    }

    /** 외부 마크업을 제거하고 UTF-8 문자를 잘라내지 않도록 길이를 제한한다. */
    private static function text(mixed $value, int $limit): string
    {
        if (!is_string($value)) return '';
        $value = preg_replace('#<(script|style|iframe)\b[^>]*>.*?</\1\s*>#is', '', $value) ?? '';
        $value = trim(html_entity_decode(strip_tags($value), ENT_QUOTES | ENT_HTML5, 'UTF-8'));
        $characters = preg_split('//u', $value, -1, PREG_SPLIT_NO_EMPTY) ?: [];
        return implode('', array_slice($characters, 0, $limit));
    }
}
