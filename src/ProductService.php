<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class ProductService
{
    private SimpleMySql $db;

    public function __construct(?SimpleMySql $db = null)
    {
        $this->db = $db ?? new SimpleMySql();
    }

    public function analyze(string $url): array
    {
        if (!filter_var($url, FILTER_VALIDATE_URL) || !in_array(parse_url($url, PHP_URL_SCHEME), ['http','https'], true)) throw new RuntimeException('올바른 상품 URL을 입력해 주세요.');
        $jobKey='globaldirect:analysis:'.hash('sha256',$url);
        $cache=new RedisCache();
        $cache->set($jobKey,json_encode(['status'=>'analyzing','started_at'=>date(DATE_ATOM)],JSON_UNESCAPED_UNICODE),300);
        $endpoint = rtrim((string) env_value('PRODUCT_WORKER_URL'), '/') . '/analyze';
        $context = stream_context_create(['http' => ['method'=>'POST','timeout'=>35,'ignore_errors'=>true,'header'=>"Content-Type: application/json\r\nX-Worker-Token: ".env_value('WORKER_TOKEN')."\r\n",'content'=>json_encode(['url'=>$url], JSON_UNESCAPED_SLASHES)]]);
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
        $product = $this->db->fetchOne('SELECT * FROM products WHERE public_id = :public_id', ['public_id' => $publicId]);
        if (!$product) throw new RuntimeException('상품을 찾을 수 없습니다.');
        $images = $this->db->fetchAll('SELECT image_url FROM product_images WHERE product_id = :product_id ORDER BY sort_order', ['product_id' => $product['id']]);
        $options = $this->db->fetchAll('SELECT option_name, values_json FROM product_options WHERE product_id = :product_id ORDER BY sort_order', ['product_id' => $product['id']]);
        $product['images'] = array_column($images, 'image_url');
        $product['options'] = array_map(static fn(array $row): array => ['name'=>$row['option_name'],'values'=>json_decode($row['values_json'], true) ?: []], $options);
        return $product;
    }

    private function store(array $data): array
    {
        $publicId = strtolower(bin2hex(random_bytes(8)));
        $title = trim((string) ($data['title'] ?? '')) ?: '상품명 확인 필요';
        return $this->db->transaction(function (SimpleMySql $db) use ($data, $publicId, $title): array {
            $productId = (int) $db->insert('products', [
                'public_id' => $publicId,
                'source_url' => $data['sourceUrl'],
                'final_url' => $data['finalUrl'] ?? $data['sourceUrl'],
                'source_host' => parse_url($data['finalUrl'] ?? $data['sourceUrl'], PHP_URL_HOST),
                'title' => $this->limit($title, 500),
                'description' => $data['description'] ?? null,
                'price' => $data['price'] ?? null,
                'currency' => substr((string) ($data['currency'] ?? 'UNKNOWN'), 0, 10),
                'availability' => $data['availability'] ?? null,
                'analysis_status' => $data['status'] ?? 'needs_review',
                'raw_json' => json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            ]);
            $images = [];
            foreach (array_slice($data['images'] ?? [], 0, 12) as $index => $image) {
                $images[] = ['product_id' => $productId, 'image_url' => $image, 'sort_order' => $index];
            }
            $db->insertMany('product_images', $images);
            $options = [];
            foreach (array_slice($data['optionGroups'] ?? [], 0, 8) as $index => $option) {
                $options[] = [
                    'product_id' => $productId,
                    'option_name' => $this->limit((string) ($option['name'] ?? '옵션'), 190),
                    'values_json' => json_encode(array_slice($option['values'] ?? [], 0, 30), JSON_UNESCAPED_UNICODE),
                    'sort_order' => $index,
                ];
            }
            $db->insertMany('product_options', $options);
            return $this->find($publicId);
        });
    }

    private function limit(string $value,int $length):string
    {
        $characters=preg_split('//u',$value,-1,PREG_SPLIT_NO_EMPTY)?:[];
        return implode('',array_slice($characters,0,$length));
    }
}
