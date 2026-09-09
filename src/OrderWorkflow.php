<?php
declare(strict_types=1);
namespace App;

final class OrderWorkflow
{
    private const TRANSITIONS = [
        'review_pending' => ['confirmed', 'cancelled', 'blocked_item'],
        'confirmed' => ['local_ordered', 'cancelled'],
        'local_ordered' => ['warehouse_received'],
        'warehouse_received' => ['inspected', 'blocked_item'],
        'inspected' => ['international_shipping', 'blocked_item'],
        'international_shipping' => ['customs'],
        'customs' => ['domestic_shipping', 'blocked_item'],
        'domestic_shipping' => ['delivered'],
    ];

    public static function canTransition(string $from,string $to):bool{return in_array($to,self::TRANSITIONS[$from]??[],true);}
    public static function nextStatuses(string $from):array{return self::TRANSITIONS[$from]??[];}
}
