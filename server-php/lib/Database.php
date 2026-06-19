<?php

declare(strict_types=1);

final class Database
{
    private static ?PDO $pdo = null;

    public static function connection(): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        if (!extension_loaded('pdo_pgsql')) {
            throw new RuntimeException(
                'PostgreSQL PHP extension (pdo_pgsql) is not enabled on this server'
            );
        }

        $host = (string) Config::get('db_host');
        $name = (string) Config::get('db_name');
        $user = (string) Config::get('db_user');

        if ($host === '' || $name === '' || $user === '') {
            throw new RuntimeException(
                'Database not configured. Create api/.env with DB_HOST, DB_NAME, DB_USER, DB_PASS'
            );
        }

        $dsn = sprintf(
            'pgsql:host=%s;port=%d;dbname=%s',
            $host,
            Config::get('db_port', 5432),
            $name
        );

        $sslMode = (string) Config::get('db_sslmode', '');
        if ($sslMode !== '') {
            $dsn .= ';sslmode=' . $sslMode;
        }

        self::$pdo = new PDO($dsn, $user, (string) Config::get('db_pass'), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);

        return self::$pdo;
    }

    public static function ping(): array
    {
        try {
            self::connection()->query('SELECT 1');
            return ['ok' => true, 'status' => 'connected'];
        } catch (Throwable $exception) {
            return [
                'ok' => false,
                'status' => 'unavailable',
                'error' => self::publicErrorMessage($exception),
            ];
        }
    }

    public static function publicErrorMessage(Throwable $exception): string
    {
        $message = $exception->getMessage();

        if ($exception instanceof RuntimeException) {
            return $message;
        }

        if (str_contains($message, 'could not find driver')) {
            return 'PostgreSQL PHP extension (pdo_pgsql) is not enabled';
        }

        if (str_contains($message, 'does not exist')) {
            return 'Payment tables missing. Run server-php/database/schema.sql on your PostgreSQL database';
        }

        if (
            str_contains($message, 'connection refused')
            || str_contains($message, 'could not connect')
            || str_contains($message, 'timeout')
        ) {
            return 'Cannot connect to PostgreSQL. Check DB_HOST, DB_PORT, firewall, and DB_SSLMODE in api/.env';
        }

        if (str_contains($message, 'password authentication failed')) {
            return 'PostgreSQL login failed. Check DB_USER and DB_PASS in api/.env';
        }

        return 'Database error. Verify api/.env and that schema.sql has been applied';
    }
}
