<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class ProductService
{
    public function analyze(string $url): array
    {
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(parse_url($url, PHP_URL_SCHEME), ['http','https'], true)) throw new RuntimeException('올바른 상품 URL을 입력해 주세요.');
        $jobKey='globaldirect:analysis:'.hash('sha256',$url);
        $cache=new RedisCache();
        $cache->set($jobKey,json_encode(['status'=>'analyzing','started_at'=>date(DATE_ATOM)],JSON_UNESCAPED_UNICODE),300);
        $endpoint = rtrim((string) env_value('PRODUCT_WORKER_URL', 'http://playwright:3000'), '/') . '/analyze';
        $context = stream_context_create(['http' => ['method'=>'POST','timeout'=>35,'ignore_errors'=>true,'header'=>"Content-Type: application/json\r\nX-Worker-Token: ".env_value('WORKER_TOKEN','')."\r\n",'content'=>json_encode(['url'=>$url], JSON_UNESCAPED_SLASHES)]]);
        $response = @file_get_contents($endpoint, false, $context);
        $payload = is_string($response) ? json_decode($response, true) : null;
        if (!is_array($payload) || empty($payload['ok'])) {
            $cache->set($jobKey,json_encode(['status'=>'failed'],JSON_UNESCAPED_UNICODE),300);
            throw new RuntimeException((string) ($payload['message'] ?? '상품 페이지 분석 서버에 연결하지 못했습니다.'));
        }
        $product=$this->store($payload['product']);
        $cache->set($jobKey,json_encode(['status'=>'complete','product_id'=>$product['public_id']],JSON_UNESCAPED_UNICODE),900);
        return $product;
    }

    public function find(string $publicId): array
    {
        $statement = Database::connection()->prepare('SELECT * FROM products WHERE public_id = ?');
        $statement->execute([$publicId]);
        $product = $statement->fetch();
        if (!$product) throw new RuntimeException('상품을 찾을 수 없습니다.');
        $images = Database::connection()->prepare('SELECT image_url FROM product_images WHERE product_id = ? ORDER BY sort_order');
        $images->execute([$product['id']]);
        $options = Database::connection()->prepare('SELECT option_name, values_json FROM product_options WHERE product_id = ? ORDER BY sort_order');
        $options->execute([$product['id']]);
        $product['images'] = array_column($images->fetchAll(), 'image_url');
        $product['options'] = array_map(static fn(array $row): array => ['name'=>$row['option_name'],'values'=>json_decode($row['values_json'], true) ?: []], $options->fetchAll());
        return $product;
    }

    private function store(array $data): array
    {
        $publicId = strtolower(bin2hex(random_bytes(8)));
        $title = trim((string) ($data['title'] ?? '')) ?: '상품명 확인 필요';
        $pdo = Database::connection();
        $pdo->beginTransaction();
        try {
            $statement = $pdo->prepare('INSERT INTO products (public_id, source_url, final_url, source_host, title, description, price, currency, availability, analysis_status, raw_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
            $statement->execute([$publicId,$data['sourceUrl'],$data['finalUrl'] ?? $data['sourceUrl'],parse_url($data['finalUrl'] ?? $data['sourceUrl'],PHP_URL_HOST),$this->limit($title,500),$data['description'] ?? null,$data['price'] ?? null,substr((string)($data['currency'] ?? 'UNKNOWN'),0,10),$data['availability'] ?? null,$data['status'] ?? 'needs_review',json_encode($data,JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES)]);
            $productId = (int) $pdo->lastInsertId();
            $imageStatement = $pdo->prepare('INSERT INTO product_images (product_id, image_url, sort_order) VALUES (?, ?, ?)');
            foreach (array_slice($data['images'] ?? [],0,12) as $index=>$image) $imageStatement->execute([$productId,$image,$index]);
            $optionStatement = $pdo->prepare('INSERT INTO product_options (product_id, option_name, values_json, sort_order) VALUES (?, ?, ?, ?)');
            foreach (array_slice($data['optionGroups'] ?? [],0,8) as $index=>$option) $optionStatement->execute([$productId,$this->limit((string)($option['name'] ?? '옵션'),190),json_encode(array_slice($option['values'] ?? [],0,30),JSON_UNESCAPED_UNICODE),$index]);
            $pdo->commit();
            return $this->find($publicId);
        } catch (\Throwable $exception) { $pdo->rollBack(); throw $exception; }
    }

    private function limit(string $value,int $length):string
    {
        $characters=preg_split('//u',$value,-1,PREG_SPLIT_NO_EMPTY)?:[];
        return implode('',array_slice($characters,0,$length));
    }
}
