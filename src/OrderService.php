<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class OrderService
{
    public function createFromProduct(array $user,string $publicId,array $input):array
    {
        $product=(new ProductService())->find($publicId);
        $quantity=max(1,min(20,(int)($input['quantity']??1)));
        $address=$input['address']??[];
        foreach(['recipient','postal_code','region','city','address1','phone'] as $field) if(trim((string)($address[$field]??''))==='') throw new RuntimeException('배송지 필수 정보를 모두 입력해 주세요.');
        $options=$input['selected_options']??[];
        if(!is_array($options))$options=[];
        $optionText=implode(' / ',array_map(static fn($key,$value)=>$key.': '.$value,array_keys($options),array_values($options)));
        $unitPrice=(float)($product['price']??0);
        $totalJpy=$product['currency']==='KRW'?(int)ceil($unitPrice*$quantity/9.15):($product['currency']==='JPY'?(int)ceil($unitPrice*$quantity):0);
        $orderNo='GD-'.date('ymd').'-'.strtoupper(bin2hex(random_bytes(3)));
        $pdo=Database::connection();$pdo->beginTransaction();
        try{
            $statement=$pdo->prepare('INSERT INTO orders (user_id,product_id,order_no,customer_name,customer_email,status,total_jpy,source_url,product_name,option_text,quantity,address_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
            $statement->execute([$user['id'],$product['id'],$orderNo,$user['name'],$user['email'],'review_pending',$totalJpy,$product['source_url'],$product['title'],$optionText,$quantity,json_encode($address,JSON_UNESCAPED_UNICODE)]);
            $orderId=(int)$pdo->lastInsertId();
            $note='구매대행 신청 접수';if(!empty($input['request_note']))$note.=' · 요청사항 있음';
            $pdo->prepare('INSERT INTO order_status_history (order_id,from_status,to_status,note) VALUES (?,NULL,?,?)')->execute([$orderId,'review_pending',$note]);
            $pdo->commit();return ['order_no'=>$orderNo,'status'=>'review_pending','estimated_total_jpy'=>$totalJpy];
        }catch(\Throwable $exception){$pdo->rollBack();throw $exception;}
    }

    public function mine(int $userId):array
    {
        $statement=Database::connection()->prepare('SELECT o.order_no,o.status,o.total_jpy,o.product_name,o.quantity,o.created_at,p.public_id product_public_id FROM orders o LEFT JOIN products p ON p.id=o.product_id WHERE o.user_id=? ORDER BY o.created_at DESC');
        $statement->execute([$userId]);return $statement->fetchAll();
    }
}
