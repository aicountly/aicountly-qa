<?php

/*
 * AICOUNTLY QA Portal — CodeIgniter 4.6 front controller.
 *
 * Deployed to cPanel public_html/api/index.php via deploy-prod-cpanel workflow.
 * Local dev:  php -S 0.0.0.0:8080 -t server-php  server-php/index.php
 */

define('FCPATH', __DIR__ . DIRECTORY_SEPARATOR);

$pathsConfig = __DIR__ . '/app/Config/Paths.php';
require realpath($pathsConfig) ?: $pathsConfig;

$paths = new Config\Paths();

if (! file_exists(__DIR__ . '/vendor/autoload.php')) {
    http_response_code(503);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode([
        'ok'      => false,
        'service' => 'aicountly-qa-api',
        'error'   => 'Composer dependencies missing. Run `composer install` inside server-php/.',
    ]);
    exit;
}

require rtrim($paths->systemDirectory, '\\/ ') . DIRECTORY_SEPARATOR . 'bootstrap.php';

$app = Config\Services::codeigniter();
$app->initialize();

$context = is_cli() ? 'php-cli' : 'web';
$app->setContext($context);

$app->run();
