<?php
declare(strict_types=1);
namespace App\Adapters;
interface ProductSourceAdapter { public function supports(string $url): bool; public function fetch(string $url): array; }
