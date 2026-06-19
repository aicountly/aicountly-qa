<?php

declare(strict_types=1);

final class Security
{
    public static function applyHeaders(): void
    {
        header('X-Content-Type-Options: nosniff');
        header('X-Frame-Options: DENY');
        header('Referrer-Policy: no-referrer');
        header('Permissions-Policy: geolocation=(), microphone=(), camera=()');
        header('Cache-Control: no-store, no-cache, must-revalidate');
    }

    public static function assertJsonPost(): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            return;
        }

        $contentType = strtolower((string) ($_SERVER['CONTENT_TYPE'] ?? ''));
        if ($contentType !== '' && !str_contains($contentType, 'application/json')) {
            Response::error('Content-Type must be application/json', 415);
        }
    }

    public static function handleCors(): void
    {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = Config::get('cors_origins', []);
        $allowedOrigin = null;

        if ($origin !== '' && in_array($origin, $allowed, true)) {
            $allowedOrigin = $origin;
        } elseif ($origin !== '' && self::isSameSiteOrigin($origin)) {
            $allowedOrigin = $origin;
        }

        if ($allowedOrigin !== null) {
            header('Access-Control-Allow-Origin: ' . $allowedOrigin);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Content-Type, X-CSRF-Token, X-Request-Id, X-Admin-Key');
            header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        }

        if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
            http_response_code(204);
            exit;
        }
    }

    private static function isSameSiteOrigin(string $origin): bool
    {
        $host = strtolower((string) ($_SERVER['HTTP_HOST'] ?? ''));
        $host = preg_replace('/:\d+$/', '', $host) ?: '';
        if ($host === '') {
            return false;
        }

        $parsed = parse_url($origin);
        if (!is_array($parsed) || empty($parsed['host'])) {
            return false;
        }

        $originHost = strtolower((string) $parsed['host']);
        if ($originHost === $host) {
            return true;
        }

        // Allow www and non-www variants for the same domain.
        $stripWww = static fn (string $value): string => str_starts_with($value, 'www.')
            ? substr($value, 4)
            : $value;

        return $stripWww($originHost) === $stripWww($host);
    }

    public static function clientIp(): string
    {
        $candidates = [
            $_SERVER['HTTP_CF_CONNECTING_IP'] ?? '',
            $_SERVER['HTTP_X_FORWARDED_FOR'] ?? '',
            $_SERVER['REMOTE_ADDR'] ?? '',
        ];

        foreach ($candidates as $value) {
            if ($value === '') {
                continue;
            }
            $ip = trim(explode(',', $value)[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }

        return '0.0.0.0';
    }

    public static function hashValue(string $value): string
    {
        $secret = (string) Config::get('app_secret');
        return hash('sha256', $secret . '|' . $value);
    }

    public static function readJsonBody(): array
    {
        $raw = file_get_contents('php://input') ?: '';
        if ($raw === '') {
            return [];
        }

        if (strlen($raw) > 8192) {
            Response::error('Request body too large', 413);
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            Response::error('Invalid JSON body', 400);
        }

        if (count($decoded) > 20) {
            Response::error('Too many fields in request', 400);
        }

        return $decoded;
    }

    public static function assertSameOriginPost(): void
    {
        if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
            return;
        }

        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $allowed = Config::get('cors_origins', []);
        if ($origin !== '' && !in_array($origin, $allowed, true) && !self::isSameSiteOrigin($origin)) {
            Response::error('Origin not allowed', 403);
        }
    }

    public static function validateCsrf(string $token): bool
    {
        if ($token === '') {
            return false;
        }

        $decoded = base64_decode($token, true);
        if ($decoded === false || !str_contains($decoded, '.')) {
            return false;
        }

        $parts = explode('.', $decoded);
        if (count($parts) !== 3) {
            return false;
        }

        [$nonce, $expires, $signature] = $parts;
        if (!ctype_digit($expires) || time() > (int) $expires) {
            return false;
        }

        $secret = (string) Config::get('app_secret');
        if ($secret === '') {
            return false;
        }

        $payload = $nonce . '.' . $expires;
        $expected = hash_hmac('sha256', $payload, $secret);

        return hash_equals($expected, $signature);
    }

    public static function issueCsrfToken(): string
    {
        $secret = (string) Config::get('app_secret');
        if ($secret === '') {
            Response::error('Server security is not configured', 503);
        }

        $nonce = bin2hex(random_bytes(16));
        $expires = (string) (time() + 3600);
        $payload = $nonce . '.' . $expires;
        $signature = hash_hmac('sha256', $payload, $secret);

        return base64_encode($payload . '.' . $signature);
    }
}
