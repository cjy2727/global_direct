<?php
declare(strict_types=1);
namespace App;

use RuntimeException;

final class CartService
{
    public function add(string $productPublicId, int $quantity, array $options, string $note): array
    {
        $product = (new ProductService())->find($productPublicId);
        $cartId = $this->cartId();
        $statement = Database::connection()->prepare('INSERT INTO cart_items (cart_id, product_id, quantity, selected_options_json, request_note) VALUES (?, ?, ?, ?, ?)');
        $safeNote=implode('',array_slice(preg_split('//u',trim($note),-1,PREG_SPLIT_NO_EMPTY)?:[],0,1000));
        $statement->execute([$cartId,$product['id'],max(1,min(20,$quantity)),json_encode($options,JSON_UNESCAPED_UNICODE),$safeNote]);
        return ['count'=>$this->count($cartId)];
    }

    public function items(): array
    {
        $cartId = $this->cartId();
        $statement = Database::connection()->prepare('SELECT ci.id,ci.quantity,ci.selected_options_json,ci.request_note,p.public_id,p.title,p.price,p.currency,(SELECT image_url FROM product_images WHERE product_id=p.id ORDER BY sort_order LIMIT 1) image_url FROM cart_items ci JOIN products p ON p.id=ci.product_id WHERE ci.cart_id=? ORDER BY ci.id DESC');
        $statement->execute([$cartId]);
        return array_map(static function(array $item):array{$item['selected_options']=json_decode($item['selected_options_json'],true)?:[];unset($item['selected_options_json']);return $item;},$statement->fetchAll());
    }

    private function cartId(): int
    {
        $key = hash('sha256', session_id());
        $pdo = Database::connection();
        $statement = $pdo->prepare('SELECT id FROM carts WHERE session_key=?');$statement->execute([$key]);
        if ($row=$statement->fetch()) return (int)$row['id'];
        $user=Auth::user();$pdo->prepare('INSERT INTO carts (user_id,session_key) VALUES (?,?)')->execute([$user['id']??null,$key]);return (int)$pdo->lastInsertId();
    }

    private function count(int $cartId): int
    {
        $statement=Database::connection()->prepare('SELECT COALESCE(SUM(quantity),0) count FROM cart_items WHERE cart_id=?');$statement->execute([$cartId]);return (int)$statement->fetch()['count'];
    }
}
