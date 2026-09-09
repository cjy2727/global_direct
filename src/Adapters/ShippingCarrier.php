<?php
declare(strict_types=1);
namespace App\Adapters;
interface ShippingCarrier { public function createLabel(array $shipment): array; public function track(string $trackingNo): array; }
