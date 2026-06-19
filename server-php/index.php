<?php

declare(strict_types=1);

require_once __DIR__ . '/lib/Config.php';
require_once __DIR__ . '/lib/Response.php';
require_once __DIR__ . '/lib/Database.php';
require_once __DIR__ . '/lib/Security.php';
require_once __DIR__ . '/lib/InputGuard.php';
require_once __DIR__ . '/lib/PaymentValidator.php';
require_once __DIR__ . '/lib/RazorpayClient.php';
require_once __DIR__ . '/lib/PaymentRepository.php';
require_once __DIR__ . '/lib/PaymentController.php';

Config::load(__DIR__);
Security::applyHeaders();
Security::handleCors();

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = preg_replace('#^/api/?#', '/', $path) ?: '/';
$path = rtrim($path, '/') ?: '/';

$controller = new PaymentController();

try {
    if ($path === '/' || $path === '/health') {
        Response::json([
            'ok' => true,
            'service' => 'sispl-org-api',
            'timestamp' => gmdate('c'),
        ]);
    }

    if ($path === '/health/db' && $method === 'GET') {
        $db = Database::ping();
        Response::json([
            'ok' => $db['ok'],
            'service' => 'sispl-org-api',
            'database' => $db['status'],
            'detail' => $db['ok'] ? null : ($db['error'] ?? 'unknown'),
        ], $db['ok'] ? 200 : 503);
    }

    if ($path === '/payments/csrf' && $method === 'GET') {
        $controller->csrfToken();
    }

    if ($path === '/payments' && $method === 'POST') {
        $controller->create();
    }

    if ($path === '/payments/verify' && $method === 'POST') {
        $controller->verify();
    }

    if ($path === '/payments/webhook/razorpay' && $method === 'POST') {
        $controller->razorpayWebhook();
    }

    if ($path === '/payments/report' && $method === 'GET') {
        $controller->report();
    }

    if ($path === '/payments/return' && in_array($method, ['GET', 'POST'], true)) {
        $controller->returnCallback();
    }

    if (preg_match('#^/payments/([A-Za-z0-9\-]+)/checkout$#', $path, $matches) && $method === 'GET') {
        $controller->checkout($matches[1]);
    }

    if (preg_match('#^/payments/([A-Za-z0-9\-]+)$#', $path, $matches) && $method === 'GET') {
        $controller->status($matches[1]);
    }

    Response::error('Not found', 404);
} catch (PDOException $exception) {
    error_log('[sispl-api] Database error: ' . $exception->getMessage());
    Response::error(Database::publicErrorMessage($exception), 503);
} catch (RuntimeException $exception) {
    error_log('[sispl-api] Configuration error: ' . $exception->getMessage());
    Response::error($exception->getMessage(), 503);
} catch (Throwable $exception) {
    error_log('[sispl-api] Unexpected error: ' . $exception->getMessage());
    Response::error('Internal server error', 500);
}
