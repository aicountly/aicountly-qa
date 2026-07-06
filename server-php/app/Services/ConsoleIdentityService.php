<?php

namespace App\Services;

/**
 * Validates Console controller SSO tokens and returns identity payload.
 */
class ConsoleIdentityService
{
    public function exchangeLaunchToken(string $token): ?array
    {
        $token = trim($token);
        if ($token === '') {
            return null;
        }

        $apiBase = rtrim((string) env('CONSOLE_API_URL', 'https://console.aicountly.org/api'), '/');
        $appCode = strtolower(trim((string) env('CONTROLLER_APP_CODE', 'qa')));

        $payload = json_encode([
            'token'    => $token,
            'app_code' => $appCode,
        ], JSON_THROW_ON_ERROR);

        $ch = curl_init($apiBase . '/auth/sso/exchange');
        if ($ch === false) {
            return null;
        }

        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_HTTPHEADER     => ['Content-Type: application/json', 'Accept: application/json'],
            CURLOPT_POSTFIELDS     => $payload,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 15,
        ]);

        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($raw === false || $status < 200 || $status >= 300) {
            log_message('error', 'Console SSO exchange failed HTTP ' . $status);

            return null;
        }

        $body = json_decode($raw, true);
        if (! is_array($body) || empty($body['success']) || ! is_array($body['data'] ?? null)) {
            return null;
        }

        return $body['data'];
    }
}
