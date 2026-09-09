<?php

declare(strict_types=1);

namespace App;

use InvalidArgumentException;
use PDO;
use PDOStatement;
use Throwable;

/**
 * GlobalDirect용 MySQL 편의 클래스.
 *
 * 모든 값은 준비된 문장으로 바인딩하고, 테이블명과 컬럼명은 안전한
 * 식별자인지 검사합니다. 연결 설정은 기존 Database 클래스를 재사용합니다.
 */
final class SimpleMySql
{
    private PDO $pdo;
    private int $affectedRows = 0;

    public function __construct(?PDO $pdo = null)
    {
        $this->pdo = $pdo ?? Database::connection();
    }

    public function connection(): PDO
    {
        return $this->pdo;
    }

    /** @return list<array<string, mixed>> */
    public function query(string $sql, array $params = []): array
    {
        return $this->fetchAll($sql, $params);
    }

    /** @return array<string, mixed>|null */
    public function fetchOne(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @return list<array<string, mixed>> */
    public function fetchAll(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    public function value(string $sql, array $params = []): mixed
    {
        $value = $this->run($sql, $params)->fetchColumn();
        return $value === false ? null : $value;
    }

    public function execute(string $sql, array $params = []): int
    {
        $statement = $this->run($sql, $params);
        return $this->affectedRows = $statement->rowCount();
    }

    /** @param array<string, mixed> $data */
    public function insert(string $table, array $data): string
    {
        if ($data === []) {
            throw new InvalidArgumentException('추가할 데이터가 비어 있습니다.');
        }

        $table = $this->identifier($table);
        $columns = array_keys($data);
        $quotedColumns = array_map(fn(string $column): string => $this->identifier($column), $columns);
        $placeholders = array_map(static fn(string $column): string => ':insert_' . $column, $columns);
        $params = [];
        foreach ($data as $column => $value) {
            $params['insert_' . $column] = $value;
        }

        $sql = sprintf(
            'INSERT INTO %s (%s) VALUES (%s)',
            $table,
            implode(', ', $quotedColumns),
            implode(', ', $placeholders)
        );
        $this->execute($sql, $params);
        return $this->lastInsertId();
    }

    /** @param list<array<string, mixed>> $rows */
    public function insertMany(string $table, array $rows): int
    {
        if ($rows === []) {
            return 0;
        }
        $columns = array_keys($rows[0]);
        if ($columns === []) {
            throw new InvalidArgumentException('추가할 데이터가 비어 있습니다.');
        }
        foreach ($rows as $row) {
            if (array_keys($row) !== $columns) {
                throw new InvalidArgumentException('일괄 추가 데이터의 컬럼 순서가 서로 다릅니다.');
            }
        }

        $table = $this->identifier($table);
        $quotedColumns = array_map(fn(string $column): string => $this->identifier($column), $columns);
        $params = [];
        $groups = [];
        foreach ($rows as $rowIndex => $row) {
            $placeholders = [];
            foreach ($row as $column => $value) {
                $key = 'row_' . $rowIndex . '_' . $column;
                $placeholders[] = ':' . $key;
                $params[$key] = $value;
            }
            $groups[] = '(' . implode(', ', $placeholders) . ')';
        }

        return $this->execute(sprintf(
            'INSERT INTO %s (%s) VALUES %s',
            $table,
            implode(', ', $quotedColumns),
            implode(', ', $groups)
        ), $params);
    }

    /** @param array<string, mixed> $data */
    public function update(string $table, array $data, string $where, array $whereParams = []): int
    {
        if ($data === []) {
            throw new InvalidArgumentException('수정할 데이터가 비어 있습니다.');
        }
        $this->assertWhere($where);
        $sets = [];
        $params = $whereParams;
        foreach ($data as $column => $value) {
            $key = 'update_' . $column;
            $sets[] = $this->identifier($column) . ' = :' . $key;
            $params[$key] = $value;
        }
        return $this->execute('UPDATE ' . $this->identifier($table) . ' SET ' . implode(', ', $sets) . ' WHERE ' . $where, $params);
    }

    public function delete(string $table, string $where, array $params = []): int
    {
        $this->assertWhere($where);
        return $this->execute('DELETE FROM ' . $this->identifier($table) . ' WHERE ' . $where, $params);
    }

    /**
     * MySQL의 INSERT ... ON DUPLICATE KEY UPDATE를 실행합니다.
     *
     * @param array<string, mixed> $data
     * @param list<string>|null $updateColumns null이면 기본키를 제외한 모든 컬럼
     */
    public function upsert(string $table, array $data, ?array $updateColumns = null): int
    {
        if ($data === []) {
            throw new InvalidArgumentException('저장할 데이터가 비어 있습니다.');
        }
        $table = $this->identifier($table);
        $columns = array_keys($data);
        $updateColumns ??= array_values(array_filter($columns, static fn(string $column): bool => $column !== 'id'));
        if ($updateColumns === []) {
            throw new InvalidArgumentException('중복 시 수정할 컬럼이 없습니다.');
        }
        foreach ($updateColumns as $column) {
            if (!array_key_exists($column, $data)) {
                throw new InvalidArgumentException("저장 데이터에 {$column} 컬럼이 없습니다.");
            }
        }

        $quoted = array_map(fn(string $column): string => $this->identifier($column), $columns);
        $params = [];
        $placeholders = [];
        foreach ($data as $column => $value) {
            $key = 'upsert_' . $column;
            $placeholders[] = ':' . $key;
            $params[$key] = $value;
        }
        $updates = array_map(fn(string $column): string => $this->identifier($column) . ' = new.' . $this->identifier($column), $updateColumns);
        $sql = sprintf('INSERT INTO %s (%s) VALUES (%s) AS new ON DUPLICATE KEY UPDATE %s', $table, implode(', ', $quoted), implode(', ', $placeholders), implode(', ', $updates));
        return $this->execute($sql, $params);
    }

    public function count(string $table, string $where = '1=1', array $params = []): int
    {
        $this->assertWhere($where);
        return (int) $this->value('SELECT COUNT(*) FROM ' . $this->identifier($table) . ' WHERE ' . $where, $params);
    }

    public function exists(string $table, string $where, array $params = []): bool
    {
        $this->assertWhere($where);
        return $this->value('SELECT 1 FROM ' . $this->identifier($table) . ' WHERE ' . $where . ' LIMIT 1', $params) !== null;
    }

    public function lastInsertId(): string
    {
        return $this->pdo->lastInsertId();
    }

    public function affectedRows(): int
    {
        return $this->affectedRows;
    }

    public function beginTransaction(): void
    {
        if (!$this->pdo->inTransaction()) {
            $this->pdo->beginTransaction();
        }
    }

    public function commit(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->commit();
        }
    }

    public function rollback(): void
    {
        if ($this->pdo->inTransaction()) {
            $this->pdo->rollBack();
        }
    }

    public function transaction(callable $callback): mixed
    {
        $this->beginTransaction();
        try {
            $result = $callback($this);
            $this->commit();
            return $result;
        } catch (Throwable $exception) {
            $this->rollback();
            throw $exception;
        }
    }

    private function run(string $sql, array $params): PDOStatement
    {
        [$sql, $params] = $this->expandArrayParams($sql, $params);
        $statement = $this->pdo->prepare($sql);
        $statement->execute($params);
        $this->affectedRows = $statement->rowCount();
        return $statement;
    }

    /** @return array{0:string,1:array<string|int,mixed>} */
    private function expandArrayParams(string $sql, array $params): array
    {
        $expanded = [];
        foreach ($params as $key => $value) {
            $normalizedKey = is_string($key) ? ltrim($key, ':') : $key;
            if (!is_array($value)) {
                $expanded[$normalizedKey] = $value;
                continue;
            }
            if (!is_string($normalizedKey)) {
                throw new InvalidArgumentException('배열 파라미터는 이름 있는 파라미터로 전달해야 합니다.');
            }
            $placeholders = [];
            foreach (array_values($value) as $index => $item) {
                $itemKey = $normalizedKey . '_array_' . $index;
                $placeholders[] = ':' . $itemKey;
                $expanded[$itemKey] = $item;
            }
            $replacement = $placeholders === [] ? 'NULL' : implode(', ', $placeholders);
            $sql = preg_replace('/:' . preg_quote($normalizedKey, '/') . '\\b/', $replacement, $sql) ?? $sql;
        }
        return [$sql, $expanded];
    }

    private function identifier(string $identifier): string
    {
        $parts = explode('.', $identifier);
        foreach ($parts as $part) {
            if (!preg_match('/^[A-Za-z_][A-Za-z0-9_]*$/', $part)) {
                throw new InvalidArgumentException("안전하지 않은 SQL 식별자입니다: {$identifier}");
            }
        }
        return implode('.', array_map(static fn(string $part): string => '`' . $part . '`', $parts));
    }

    private function assertWhere(string $where): void
    {
        if (trim($where) === '') {
            throw new InvalidArgumentException('WHERE 조건은 비워둘 수 없습니다.');
        }
    }
}
