<?php

declare(strict_types=1);

final class Config
{
    /** Partner sites that POST donations cross-origin (merged with CORS_ALLOWED_ORIGINS). */
    private const DEFAULT_CORS_ORIGINS = [
        'https://sispl.org',
        'https://www.sispl.org',
        'https://aicountly.co.in',
        'https://www.aicountly.co.in',
        'https://positivetree.ngo',
        'https://www.positivetree.ngo',
        'https://aicountly.github.io',
    ];

    private static ?array $values = null;

    public static function load(string $basePath): void
    {
        if (self::$values !== null) {
            return;
        }

        $envFile = $basePath . '/.env';
        if (is_readable($envFile)) {
            $lines = file($envFile, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: [];
            foreach ($lines as $line) {
                $line = trim($line);
                if ($line === '' || str_starts_with($line, '#') || !str_contains($line, '=')) {
                    continue;
                }
                [$key, $value] = explode('=', $line, 2);
                $_ENV[trim($key)] = trim($value, " \t\"'");
            }
        }

        $envCorsOrigins = array_values(array_filter(array_map(
            'trim',
            explode(',', $_ENV['CORS_ALLOWED_ORIGINS'] ?? '')
        )));

        self::$values = [
            'app_env' => $_ENV['APP_ENV'] ?? 'production',
            'app_secret' => $_ENV['APP_SECRET'] ?? '',
            'db_host' => $_ENV['DB_HOST'] ?? 'localhost',
            'db_port' => (int) ($_ENV['DB_PORT'] ?? 5432),
            'db_name' => $_ENV['DB_NAME'] ?? '',
            'db_user' => $_ENV['DB_USER'] ?? '',
            'db_pass' => $_ENV['DB_PASS'] ?? '',
            'db_sslmode' => $_ENV['DB_SSLMODE'] ?? '',
            'cors_origins' => array_values(array_unique(array_merge(
                self::DEFAULT_CORS_ORIGINS,
                $envCorsOrigins
            ))),
            'payment_gateway_url' => $_ENV['PAYMENT_GATEWAY_URL'] ?? '',
            'payment_admin_api_key' => $_ENV['PAYMENT_ADMIN_API_KEY'] ?? '',
            'payment_rate_limit_per_hour' => (int) ($_ENV['PAYMENT_RATE_LIMIT_PER_HOUR'] ?? 20),
            'payment_max_amount_inr' => (float) ($_ENV['PAYMENT_MAX_AMOUNT_INR'] ?? 10000000),
            'payment_max_amount_usd' => (float) ($_ENV['PAYMENT_MAX_AMOUNT_USD'] ?? 100000),
            'razorpay_key_id' => $_ENV['RAZORPAY_KEY_ID'] ?? '',
            'razorpay_key_secret' => $_ENV['RAZORPAY_KEY_SECRET'] ?? '',
            'razorpay_webhook_secret' => $_ENV['RAZORPAY_WEBHOOK_SECRET'] ?? '',
            'razorpay_company_name' => $_ENV['RAZORPAY_COMPANY_NAME'] ?? 'SISPL',
        ];
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        return self::$values[$key] ?? $default;
    }
}
