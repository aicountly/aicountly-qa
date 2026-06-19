<?php

declare(strict_types=1);

final class InputGuard
{
    /** @var list<string> */
    private const SUSPICIOUS_PATTERNS = [
        '/<\s*script/i',
        '/javascript\s*:/i',
        '/on\w+\s*=/i',
        '/(\-\-|;\s*(drop|select|insert|update|delete|union|alter|exec|sleep|benchmark)\b)/i',
        '/(\.\.\/|\\\\)/',
        '/<\?php/i',
        '/\x00/',
    ];

    public static function cleanWhitespace(string $value): string
    {
        $value = str_replace("\0", '', $value);
        $collapsed = preg_replace('/\s+/u', ' ', $value);

        return trim($collapsed ?? '');
    }

    public static function assertSafe(string $value, string $fieldLabel = 'Input'): void
    {
        if ($value === '') {
            return;
        }

        foreach (self::SUSPICIOUS_PATTERNS as $pattern) {
            if (preg_match($pattern, $value)) {
                error_log('[sispl-api] Blocked suspicious input in ' . $fieldLabel);
                Response::error('Invalid characters detected. Please use letters and numbers only.', 400);
            }
        }
    }

    public static function sanitizeClientName(string $value): string
    {
        $value = self::cleanWhitespace($value);
        $filtered = preg_replace('/[^\p{L}\p{N} ]+/u', '', $value);

        return trim($filtered ?? '');
    }

    public static function sanitizeInvoiceRef(string $value): string
    {
        $value = self::cleanWhitespace($value);
        $filtered = preg_replace('/[^A-Za-z0-9-]+/', '', $value);

        return strtoupper(trim($filtered ?? ''));
    }

    public static function sanitizeProjectName(string $value): string
    {
        $value = self::cleanWhitespace($value);
        $filtered = preg_replace('/[^\p{L}\p{N} ]+/u', '', $value);

        return trim($filtered ?? '');
    }

    public static function sanitizeDonorName(string $value): string
    {
        // Donor names may include diacritics, periods, hyphens and apostrophes.
        $value = self::cleanWhitespace($value);
        $filtered = preg_replace("/[^\\p{L}\\p{N} .'\\-]+/u", '', $value);

        return trim($filtered ?? '');
    }

    public static function sanitizeEmail(string $value): string
    {
        $value = self::cleanWhitespace($value);
        $value = strtolower($value);
        $filtered = preg_replace('/[^A-Za-z0-9@._\-+]+/', '', $value);

        return trim($filtered ?? '');
    }

    public static function sanitizePhone(string $value): string
    {
        $value = self::cleanWhitespace($value);
        $filtered = preg_replace('/[^0-9+\- ]+/', '', $value);

        return trim($filtered ?? '');
    }

    public static function sanitizePan(string $value): string
    {
        $value = self::cleanWhitespace($value);
        $value = strtoupper($value);
        $filtered = preg_replace('/[^A-Z0-9]+/', '', $value);

        return trim($filtered ?? '');
    }
}
