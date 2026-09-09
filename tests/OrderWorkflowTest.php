<?php

declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';

use App\OrderWorkflow;

assert(OrderWorkflow::canTransition('review_pending', 'confirmed'));
assert(!OrderWorkflow::canTransition('review_pending', 'delivered'));
assert(OrderWorkflow::nextStatuses('delivered') === []);

echo "OrderWorkflowTest: OK\n";
