<?php

/**
 * Print QA_DB_* from .env (masked) and test PostgreSQL PDO.
 * Usage: php check-env.php
 */

declare(strict_types=1);

$root = __DIR__;
chdir($root);

echo "=== AICOUNTLY QA API environment check ===\n";
echo 'PHP: ' . PHP_VERSION . ' (' . PHP_SAPI . ")\n";
echo 'pdo_pgsql: ' . (extension_loaded('pdo_pgsql') ? 'yes' : 'NO — enable in cPanel MultiPHP') . "\n";
echo 'error views: ' . (is_file($root . '/app/Views/errors/cli/error_exception.php') ? 'yes' : 'NO — copy from vendor') . "\n";
echo '.env file: ' . (is_file($root . '/.env') ? 'yes (' . filesize($root . '/.env') . ' bytes)' : 'MISSING') . "\n";

if (! is_file($root . '/vendor/autoload.php')) {
    fwrite(STDERR, "vendor/ missing — run composer install\n");
    exit(1);
}

require $root . '/vendor/autoload.php';

if (class_exists(\CodeIgniter\Config\DotEnv::class) && is_file($root . '/.env')) {
    (new \CodeIgniter\Config\DotEnv($root))->load();
}

$read = static function (string $key, string $default = ''): string {
    $value = $_ENV[$key] ?? $_SERVER[$key] ?? getenv($key);

    return ($value === false || $value === null) ? $default : (string) $value;
};

$vars = [
    'QA_DB_HOST'     => $read('QA_DB_HOST'),
    'QA_DB_PORT'     => $read('QA_DB_PORT', '5432'),
    'QA_DB_NAME'     => $read('QA_DB_NAME'),
    'QA_DB_USER'     => $read('QA_DB_USER'),
    'QA_DB_PASSWORD' => $read('QA_DB_PASSWORD'),
];

echo "\n--- QA_DB_* (from .env) ---\n";
foreach ($vars as $key => $val) {
    if ($key === 'QA_DB_PASSWORD') {
        echo $key . '=*** (' . strlen($val) . " chars)\n";
    } else {
        $shown = $val === '' ? '(EMPTY — set in api/.env on the server)' : $val;
        echo $key . '=' . $shown . "\n";
    }
}

$missing = [];
foreach (['QA_DB_HOST', 'QA_DB_NAME', 'QA_DB_USER', 'QA_DB_PASSWORD'] as $key) {
    if ($vars[$key] === '') {
        $missing[] = $key;
    }
}

if ($missing !== []) {
    fwrite(STDERR, "\nERROR: missing " . implode(', ', $missing) . "\n");
    fwrite(STDERR, "Fix api/.env on the server (copy from .env.example if needed).\n");
    exit(1);
}

if (! extension_loaded('pdo_pgsql')) {
    exit(1);
}

$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s',
    $vars['QA_DB_HOST'],
    $vars['QA_DB_PORT'],
    $vars['QA_DB_NAME'],
);

echo "\n--- PDO test ---\n";

try {
    $pdo = new PDO($dsn, $vars['QA_DB_USER'], $vars['QA_DB_PASSWORD'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    ]);
    $pdo->query('SELECT 1');
    echo "PDO OK\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, 'PDO FAILED: ' . $e->getMessage() . "\n");
    exit(1);
}
