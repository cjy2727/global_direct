<?php
declare(strict_types=1);
namespace App;

use PDOException;
use RuntimeException;

final class Auth
{
    public function register(string $email, string $password, string $name): array
    {
        $email = strtolower(trim($email));
        $name = trim($name);
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new RuntimeException('올바른 이메일 주소를 입력해 주세요.');
        if (strlen($name) < 2 || strlen($name) > 300) throw new RuntimeException('이름은 2자 이상 100자 이하로 입력해 주세요.');
        if (strlen($password) < 10) throw new RuntimeException('비밀번호는 10자 이상 입력해 주세요.');
        try {
            $statement = Database::connection()->prepare('INSERT INTO users (email, password_hash, name) VALUES (?, ?, ?)');
            $statement->execute([$email, password_hash($password, PASSWORD_DEFAULT), $name]);
        } catch (PDOException $exception) {
            if ((string) $exception->getCode() === '23000') throw new RuntimeException('이미 가입된 이메일 주소입니다.');
            throw $exception;
        }
        return $this->establishSession((int) Database::connection()->lastInsertId(), $email, $name, 'customer');
    }

    public function login(string $email, string $password): array
    {
        $statement = Database::connection()->prepare('SELECT id, email, password_hash, name, role FROM users WHERE email = ?');
        $statement->execute([strtolower(trim($email))]);
        $user = $statement->fetch();
        if (!$user || !password_verify($password, $user['password_hash'])) throw new RuntimeException('이메일 또는 비밀번호가 올바르지 않습니다.');
        return $this->establishSession((int) $user['id'], $user['email'], $user['name'], $user['role']);
    }

    public static function user(): ?array { return isset($_SESSION['user']) && is_array($_SESSION['user']) ? $_SESSION['user'] : null; }
    public static function logout(): void { unset($_SESSION['user']); session_regenerate_id(true); }
    private function establishSession(int $id, string $email, string $name, string $role): array
    {
        session_regenerate_id(true);
        $_SESSION['user'] = compact('id', 'email', 'name', 'role');
        return $_SESSION['user'];
    }
}
