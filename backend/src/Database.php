<?php
declare(strict_types=1);

final class Database {
    private PDO $pdo;

    public function __construct() {
        $host = getenv('DB_HOST') ?: 'mysql';
        $port = getenv('DB_PORT') ?: '3306';
        $name = getenv('DB_NAME') ?: 'uploader';
        $user = getenv('DB_USER') ?: 'uploader';
        $pass = getenv('DB_PASSWORD') ?: 'uploader';

        $dsn = "mysql:host={$host};port={$port};dbname={$name};charset=utf8mb4";

        $this->pdo = new PDO($dsn, $user, $pass, [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
    }

    public function pdo(): PDO {
        return $this->pdo;
    }
}
