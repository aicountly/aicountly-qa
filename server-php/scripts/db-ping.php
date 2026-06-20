<?php

/**
 * CLI smoke test: PostgreSQL reachability using server-php/.env (QA_DB_*).
 * Usage: php scripts/db-ping.php
 */

declare(strict_types=1);

$root = dirname(__DIR__);
chdir($root);

if (! file_exists($root . '/vendor/autoload.php')) {
    fwrite(STDERR, "Run composer install in server-php/ first.\n");
    exit(1);
}

require $root . '/vendor/autoload.php';

if (class_exists(\CodeIgniter\Config\DotEnv::class)) {
    (new \CodeIgniter\Config\DotEnv($root))->load();
}

$readEnv = static function (string $key, string $default = ''): string {
    $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);

    return ($value === false || $value === null) ? $default : (string) $value;
};

$host = $readEnv('QA_DB_HOST');
$port = $readEnv('QA_DB_PORT', '5432');
$name = $readEnv('QA_DB_NAME');
$user = $readEnv('QA_DB_USER');
$pass = $readEnv('QA_DB_PASSWORD');

foreach (['QA_DB_HOST' => $host, 'QA_DB_NAME' => $name, 'QA_DB_USER' => $user] as $label => $val) {
    if ($val === '' || $val === null) {
        fwrite(STDERR, "Missing or empty {$label} in .env\n");
        exit(1);
    }
}

if (! extension_loaded('pdo_pgsql')) {
    fwrite(STDERR, "pdo_pgsql extension is not loaded for PHP CLI.\n");
    exit(1);
}

$dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s', $host, $port, $name);

try {
    $pdo = new PDO($dsn, $user, $pass, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $pdo->query('SELECT 1');
    echo "PDO PostgreSQL OK (host={$host}, db={$name})\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'PDO PostgreSQL FAILED: ' . $e->getMessage() . "\n");
    exit(1);
}
