<?php

declare(strict_types=1);

final class RazorpayClient
{
    private string $keyId;
    private string $keySecret;
    private string $webhookSecret;

    public function __construct()
    {
        $this->keyId = (string) Config::get('razorpay_key_id', '');
        $this->keySecret = (string) Config::get('razorpay_key_secret', '');
        $this->webhookSecret = (string) Config::get('razorpay_webhook_secret', '');
    }

    public function isConfigured(): bool
    {
        return $this->keyId !== '' && $this->keySecret !== '';
    }

    public function keyId(): string
    {
        return $this->keyId;
    }

    public function createOrder(int $amountSubunits, string $currency, string $receipt, array $notes = []): array
    {
        return $this->request('POST', '/orders', [
            'amount' => $amountSubunits,
            'currency' => $currency,
            'receipt' => $receipt,
            'notes' => $notes,
        ]);
    }

    public function fetchOrder(string $orderId): ?array
    {
        if ($orderId === '') {
            return null;
        }

        return $this->requestOptional('GET', '/orders/' . rawurlencode($orderId));
    }

    public function fetchOrderPayments(string $orderId): array
    {
        if ($orderId === '') {
            return ['items' => []];
        }

        $result = $this->requestOptional('GET', '/orders/' . rawurlencode($orderId) . '/payments');
        return $result ?? ['items' => []];
    }

    public function verifyPaymentSignature(string $orderId, string $paymentId, string $signature): bool
    {
        if ($orderId === '' || $paymentId === '' || $signature === '' || !$this->isConfigured()) {
            return false;
        }

        $payload = $orderId . '|' . $paymentId;
        $expected = hash_hmac('sha256', $payload, $this->keySecret);

        return hash_equals($expected, $signature);
    }

    public function verifyWebhookSignature(string $payload, string $signature): bool
    {
        if ($this->webhookSecret === '' || $signature === '' || $payload === '') {
            return false;
        }

        $expected = hash_hmac('sha256', $payload, $this->webhookSecret);

        return hash_equals($expected, $signature);
    }

    private function request(string $method, string $path, array $body = []): array
    {
        if (!$this->isConfigured()) {
            Response::error('Razorpay is not configured', 503);
        }

        $url = 'https://api.razorpay.com/v1' . $path;
        $ch = curl_init($url);

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_USERPWD => $this->keyId . ':' . $this->keySecret,
            CURLOPT_TIMEOUT => 30,
        ]);

        if ($method !== 'GET' && $body !== []) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }

        $responseBody = curl_exec($ch);
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($responseBody === false) {
            error_log('[razorpay] cURL error: ' . $curlError);
            Response::error('Unable to reach payment gateway', 502);
        }

        $decoded = json_decode($responseBody, true);
        if (!is_array($decoded)) {
            error_log('[razorpay] Invalid response: ' . $responseBody);
            Response::error('Invalid payment gateway response', 502);
        }

        if ($statusCode >= 400) {
            $message = $decoded['error']['description'] ?? 'Payment gateway request failed';
            error_log('[razorpay] API error (' . $statusCode . '): ' . $message);
            Response::error($message, 502);
        }

        return $decoded;
    }

    /** Same as request() but returns null instead of terminating the request on gateway errors. */
    private function requestOptional(string $method, string $path, array $body = []): ?array
    {
        if (!$this->isConfigured()) {
            return null;
        }

        $url = 'https://api.razorpay.com/v1' . $path;
        $ch = curl_init($url);

        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CUSTOMREQUEST => $method,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Accept: application/json',
            ],
            CURLOPT_USERPWD => $this->keyId . ':' . $this->keySecret,
            CURLOPT_TIMEOUT => 30,
        ]);

        if ($method !== 'GET' && $body !== []) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        }

        $responseBody = curl_exec($ch);
        $statusCode = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($responseBody === false) {
            error_log('[razorpay] cURL error: ' . $curlError);
            return null;
        }

        $decoded = json_decode($responseBody, true);
        if (!is_array($decoded) || $statusCode >= 400) {
            return null;
        }

        return $decoded;
    }

    public static function toSubunits(float $amount): int
    {
        return (int) round($amount * 100);
    }
}
