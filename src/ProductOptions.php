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

    /** 저장된 장바구니를 원본 옵션명과 선택 문구로 표시한다. */
    public static function displayLabels(array $definitions, array $selected): array
    {
        $labels = [];
        foreach ($selected as $id => $value) {
            $group = array_values(array_filter($definitions, static fn($item) => $item['id'] === $id))[0] ?? null;
            $choice = $group ? (array_values(array_filter($group['values'] ?? [], static fn($item) => (string) $item['id'] === (string) $value))[0] ?? null) : null;
            $name = $group['name'] ?? $id;
            $labelKey = array_key_exists($name, $labels) ? $name . ' (' . (count($labels) + 1) . ')' : $name;
            $labels[$labelKey] = $choice['label'] ?? $value;
        }
        return $labels;
    }

    /** 고객 입력을 정의와 대조하고 식별자, 표시 문구, 추가금액을 서버에서 확정한다. */
    public static function validate(array $definitions, mixed $input): array
    {
        if (!is_array($input)) throw new RuntimeException('상품 옵션을 확인해 주세요.');
        $selected = [];
        $labels = [];
        $delta = 0.0;
        $priceKnown = true;
        $combination = self::selectedCombination($definitions, $input);
        $linkedIds = $combination['ids'] ?? [];
        if (!$definitions) {
            foreach ($input as $key => $value) {
                if ($key !== '직접 입력 옵션' || !is_string($value) || strlen($value) > 2000) throw new RuntimeException('상품 옵션을 확인해 주세요.');
                if (trim($value) !== '') $selected[$key] = $labels[$key] = trim($value);
            }
            return ['selected' => $selected, 'labels' => $labels, 'price_delta' => $selected ? null : 0.0];
        }
        // 기존 장바구니의 이름 키는 이름이 유일한 이전 형식에만 호환한다.
        foreach ($definitions as $group) {
            if (!str_starts_with($group['id'], 'legacy-') || !array_key_exists($group['name'], $input)) continue;
            if (count(array_filter($definitions, static fn($item) => $item['name'] === $group['name'])) !== 1) continue;
            $input[$group['id']] ??= $input[$group['name']];
            unset($input[$group['name']]);
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
            $labelKey = array_key_exists($group['name'], $labels)
                ? $group['name'] . ' (' . (count($labels) + 1) . ')' : $group['name'];
            $labels[$labelKey] = $label;
            if (!in_array($group['id'], $linkedIds, true)) {
                if (!is_numeric($extra) || !is_finite((float) $extra)) $priceKnown = false;
                else $delta += (float) $extra;
            }
        }
        if ($combination !== null) {
            $extra = $combination['row']['priceDelta'] ?? null;
            if (!is_numeric($extra) || !is_finite((float) $extra)) $priceKnown = false;
            else $delta += (float) $extra;
        }
        return ['selected' => $selected, 'labels' => $labels, 'price_delta' => $priceKnown ? $delta : null];
    }

    /** 수집된 유효 조합으로 서버에서도 교차 검증하며 조합 가격은 한 번만 합산한다. */
    private static function selectedCombination(array $definitions, array $input): ?array
    {
        foreach ($definitions as $group) {
            if (empty($group['combinationGroupIds']) || empty($group['combinations'])) continue;
            $ids = $group['combinationGroupIds'];
            foreach ($group['combinations'] as $row) {
                if (!empty($row['disabled'])) continue;
                $matches = true;
                foreach ($ids as $id) {
                    if (!isset($input[$id], $row['values'][$id]) || !is_string($input[$id])
                        || trim($input[$id]) !== (string) $row['values'][$id]) {
                        $matches = false;
                        break;
                    }
                }
                if ($matches) return ['ids' => $ids, 'row' => $row];
            }
            throw new RuntimeException('선택한 옵션 조합은 구매 가능 여부가 확인되지 않았습니다. 옵션을 다시 선택해 주세요.');
        }
        return null;
    }
}
