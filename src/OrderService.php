<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class OrderService
{
    private SimpleMySql $db;

    public function __construct(?SimpleMySql $db = null)
    {
        $this->db = $db ?? new SimpleMySql();
    }

    public function createFromProduct(array $user,string $publicId,array $input):array
    {
        $product=(new ProductService($this->db))->find($publicId);
        $quantity=max(1,min(20,(int)($input['quantity']??1)));
        $address=$input['address']??[];
        foreach(['recipient','postal_code','region','city','address1','phone'] as $field) if(trim((string)($address[$field]??''))==='') throw new RuntimeException('배송지 필수 정보를 모두 입력해 주세요.');
        $options=$input['selected_options']??[];
        if(!is_array($options))$options=[];
        $optionText=implode(' / ',array_map(static fn($key,$value)=>$key.': '.$value,array_keys($options),array_values($options)));
        $unitPrice=(float)($product['price']??0);
        $totalJpy=self::estimateTotalJpy($unitPrice,(string)($product['currency']??''),$quantity);
        $orderNo='GD-'.date('ymd').'-'.strtoupper(bin2hex(random_bytes(3)));
        return $this->db->transaction(function (SimpleMySql $db) use ($user, $product, $orderNo, $totalJpy, $optionText, $quantity, $address, $input): array {
            $orderId=(int)$db->insert('orders', [
                'user_id' => $user['id'],
                'product_id' => $product['id'],
                'order_no' => $orderNo,
                'customer_name' => $user['name'],
                'customer_email' => $user['email'],
                'status' => 'review_pending',
                'total_jpy' => $totalJpy,
                'source_url' => $product['source_url'],
                'product_name' => $product['title'],
                'option_text' => $optionText,
                'quantity' => $quantity,
                'address_json' => json_encode($address,JSON_UNESCAPED_UNICODE),
            ]);
            $note='구매대행 신청 접수';if(!empty($input['request_note']))$note.=' · 요청사항 있음';
            $db->insert('order_status_history', ['order_id'=>$orderId,'from_status'=>null,'to_status'=>'review_pending','note'=>$note]);
            return ['order_no'=>$orderNo,'status'=>'review_pending','estimated_total_jpy'=>$totalJpy];
        });
    }

    public static function estimateTotalJpy(float $unitPrice,string $currency,int $quantity):int
    {
        $quantity=max(1,$quantity);
        $krwPerJpy=max(0.000001,(float)\env_value('KRW_PER_JPY'));
        $usdJpyRate=max(0,(float)\env_value('USD_JPY_RATE'));
        return match(strtoupper($currency)){
            'JPY'=>(int)ceil($unitPrice*$quantity),
            'KRW'=>(int)ceil($unitPrice*$quantity/$krwPerJpy),
            'USD'=>(int)ceil($unitPrice*$quantity*$usdJpyRate),
            default=>0,
        };
    }

    public function mine(int $userId):array
    {
        return $this->db->fetchAll('SELECT o.order_no,o.status,o.total_jpy,o.product_name,o.quantity,o.created_at,p.public_id product_public_id FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.user_id=:user_id ORDER BY o.created_at DESC', ['user_id' => $userId]);
    }
}
