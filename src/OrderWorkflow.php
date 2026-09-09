<?php

declare(strict_types=1);

namespace App;

final class OrderWorkflow
{
    private const TRANSITIONS = [
        'payment_pending' => ['paid', 'cancelled'],
        'paid' => ['local_ordered', 'refund_requested'],
        'local_ordered' => ['warehouse_received', 'refund_requested'],
        'warehouse_received' => ['inspected'],
        'inspected' => ['international_shipping', 'blocked_item'],
        'international_shipping' => ['customs'],
        'customs' => ['domestic_shipping', 'blocked_item'],
        'domestic_shipping' => ['delivered'],
        'refund_requested' => ['refunded'],
    ];

    public static function canTransition(string $from, string $to): bool
    {
        return in_array($to, self::TRANSITIONS[$from] ?? [], true);
    }

    public static function nextStatuses(string $from): array
    {
        return self::TRANSITIONS[$from] ?? [];
    }
}
