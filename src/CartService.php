<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class CartService
{
    private SimpleMySql $db;

    public function __construct(?SimpleMySql $db = null)
    {
        $this->db = $db ?? new SimpleMySql();
    }

    public function add(string $productPublicId, int $quantity, array $options, string $note): array
    {
        $product = (new ProductService($this->db))->find($productPublicId);
        $cartId = $this->cartId();
        $safeNote=implode('',array_slice(preg_split('//u',trim($note),-1,PREG_SPLIT_NO_EMPTY)?:[],0,1000));
        $this->db->insert('cart_items', [
            'cart_id' => $cartId,
            'product_id' => $product['id'],
            'quantity' => max(1,min(20,$quantity)),
            'selected_options_json' => json_encode($options,JSON_UNESCAPED_UNICODE),
            'request_note' => $safeNote,
        ]);
        return ['count'=>$this->count($cartId)];
    }

    public function items(): array
    {
        $cartId = $this->cartId();
        $items = $this->db->fetchAll('SELECT ci.id,ci.quantity,ci.selected_options_json,ci.request_note,p.public_id,p.title,p.price,p.currency,(SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY sort_order LIMIT 1) image_url FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=:cart_id ORDER BY ci.id DESC', ['cart_id' => $cartId]);
        return array_map(static function(array $item):array{$item['selected_options']=json_decode($item['selected_options_json'],true)?:[];unset($item['selected_options_json']);return $item;},$items);
    }

    private function cartId(): int
    {
        $key = hash('sha256', session_id());
        $row = $this->db->fetchOne('SELECT id FROM carts WHERE session_key=:session_key', ['session_key' => $key]);
        if ($row) return (int)$row['id'];
        $user=Auth::user();
        return (int)$this->db->insert('carts', ['user_id' => $user['id']??null, 'session_key' => $key]);
    }

    private function count(int $cartId): int
    {
        return (int)$this->db->value('SELECT COALESCE(SUM(quantity),0) FROM cart_items WHERE cart_id=:cart_id', ['cart_id' => $cartId]);
    }
}
