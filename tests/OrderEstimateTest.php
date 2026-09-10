<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\OrderService;

assert(OrderService::estimateTotalJpy(1000, 'JPY', 2) === 2000);
assert(OrderService::estimateTotalJpy(9150, 'KRW', 2) === 2000);
assert(OrderService::estimateTotalJpy(10, 'USD', 2) === 3000);
assert(OrderService::estimateTotalJpy(10, 'UNKNOWN', 2) === 0);

echo "OrderEstimateTest: OK\n";
