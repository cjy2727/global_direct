<?php

declare(strict_types=1);
namespace App;

use RuntimeException;

/** 옵션 정의의 이전 형식 호환과 고객 입력 검증을 담당한다. */
final class ProductOptions
{
    /** JSON 배열(이전 선택형)과 형식 정보를 가진 객체를 같은 모델로 읽는다. */
    public static function fromRows(array $rows): array
    {
        $groups = [];
        foreach ($rows as $index => $row) {
            $data = json_decode($row['values_json'], true) ?: [];
            $modern = ($data['version'] ?? null) === 2;
            $group = $modern ? $data : [
                'id' => 'legacy-' . $index, 'type' => 'select', 'required' => true,
                'values' => array_map(static fn($value) => ['id' => (string) $value, 'label' => (string) $value, 'priceDelta' => null, 'disabled' => false], $data),
            ];
            $group['name'] = $row['option_name'];
            $group['inputType'] = in_array($group['inputType'] ?? '', ['text', 'email', 'tel'], true) ? $group['inputType'] : 'text';
            $group['placeholder'] = $group['placeholder'] ?? '';
            $groups[] = $group;
        }
        return $groups;
    }

    /** 顧客入力を定義と照合し、識別子・表示文言・追加金額をサーバー側で確定する。 */
    public static function validate(array $definitions, mixed $input): array
    {
        if (!is_array($input)) throw new RuntimeException('상품 옵션을 확인해 주세요.');
        $selected = [];
        $labels = [];
        $delta = 0.0;
        $priceKnown = true;
        if (!$definitions) {
            foreach ($input as $key => $value) {
                if ($key !== '직접 입력 옵션' || !is_string($value) || strlen($value) > 2000) throw new RuntimeException('상품 옵션을 확인해 주세요.');
                if (trim($value) !== '') $selected[$key] = $labels[$key] = trim($value);
            }
            return ['selected' => $selected, 'labels' => $labels, 'price_delta' => $selected ? null : 0.0];
        }
        $allowed = array_column($definitions, 'id');
        foreach (array_keys($input) as $key) {
            if (!in_array($key, $allowed, true)) throw new RuntimeException('상품 옵션을 다시 선택해 주세요.');
        }
        foreach ($definitions as $group) {
            $value = $input[$group['id']] ?? '';
            if (!is_string($value) || strlen($value) > 2000) throw new RuntimeException('옵션 입력 형식이나 길이를 확인해 주세요.');
            $value = trim($value);
            if ($value === '') {
                if ($group['required']) throw new RuntimeException($group['name'] . ' 항목을 입력해 주세요.');
                continue;
            }
            $label = $value;
            $extra = $group['priceDelta'] ?? null;
            if ($group['type'] === 'select') {
                $choices = array_values(array_filter($group['values'], static fn($choice) => (string) $choice['id'] === $value));
                if (!$choices || !empty($choices[0]['disabled'])) throw new RuntimeException($group['name'] . ' 항목의 선택값을 확인해 주세요.');
                $label = $choices[0]['label'];
                $extra = $choices[0]['priceDelta'] ?? null;
            } elseif ($group['inputType'] === 'email' && !filter_var($value, FILTER_VALIDATE_EMAIL)) {
                throw new RuntimeException('이메일 형식을 확인해 주세요.');
            }
            $selected[$group['id']] = $value;
            $labels[$group['name'] . ' [' . $group['id'] . ']'] = $label;
            if (!is_numeric($extra) || !is_finite((float) $extra)) $priceKnown = false;
            else $delta += (float) $extra;
        }
        return ['selected' => $selected, 'labels' => $labels, 'price_delta' => $priceKnown ? $delta : null];
    }
}
