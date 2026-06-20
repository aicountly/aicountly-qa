<?php

declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = preg_replace('#^/api/?#', '/', $path) ?: '/';
$path = rtrim($path, '/') ?: '/';

if ($method === 'OPTIONS') {
    http_response_code(204);
    exit;
}

if ($path === '/' || $path === '/health') {
    echo json_encode([
        'ok' => true,
        'service' => 'aicountly-qa-api',
        'status' => 'scaffold',
        'message' => 'CodeIgniter 4.6 QA API will be added in a later phase.',
        'timestamp' => gmdate('c'),
    ], JSON_UNESCAPED_SLASHES);
    exit;
}

http_response_code(404);
echo json_encode(['ok' => false, 'error' => 'Not found'], JSON_UNESCAPED_SLASHES);
