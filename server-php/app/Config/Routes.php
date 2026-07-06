<?php

namespace Config;

use CodeIgniter\Router\RouteCollection;

/** @var RouteCollection $routes */

$routes->get('/', static function () {
    return service('response')->setJSON([
        'ok'      => true,
        'service' => 'aicountly-qa-api',
        'version' => 'v1',
        'docs'    => '/api/v1',
    ]);
});

$routes->get('/health', static function () {
    $jwtSecret = (string) env('QA_JWT_SECRET', '');
    $jwtOk     = $jwtSecret !== '' && strlen($jwtSecret) >= 32;
    $vaultKey  = (string) env('QA_VAULT_KEY', '');
    $vaultOk   = $vaultKey !== '' && strlen($vaultKey) >= 32;

    return service('response')->setJSON([
        'ok'        => $jwtOk,
        'service'   => 'aicountly-qa-api',
        'status'    => $jwtOk ? 'ready' : 'misconfigured',
        'timestamp' => gmdate('c'),
        'checks'    => [
            'jwt_secret' => $jwtOk ? 'ok' : 'missing or too short (need 32+ chars in api/.env)',
            'vault_key'  => $vaultOk ? 'ok' : 'missing or too short',
        ],
    ]);
});

$routes->group('v1', static function ($routes) {
    // Public auth endpoints — no JWT.
    $routes->post('auth/login', 'Api\\V1\\AuthController::login');
    $routes->post('auth/controller-sso', 'Api\\V1\\AuthController::controllerSso');
    $routes->post('auth/refresh', 'Api\\V1\\AuthController::refresh');

    // Worker endpoints — separate worker token (long-lived), not user JWT.
    $routes->group('worker', ['filter' => 'worker-auth'], static function ($routes) {
        $routes->get('next-session', 'Api\\V1\\WorkerController::nextSession');
        $routes->post('ping', 'Api\\V1\\WorkerController::ping');
        $routes->post('sessions/(:num)/claim', 'Api\\V1\\WorkerController::claim/$1');
        $routes->post('sessions/(:num)/heartbeat', 'Api\\V1\\WorkerController::heartbeat/$1');
        $routes->post('sessions/(:num)/result', 'Api\\V1\\WorkerController::postResult/$1');
        $routes->post('sessions/(:num)/evidence', 'Api\\V1\\WorkerController::uploadEvidence/$1');
        $routes->get('credentials/(:num)', 'Api\\V1\\WorkerController::credentials/$1');
    });

    // Authenticated portal endpoints.
    $routes->group('', ['filter' => 'jwt'], static function ($routes) {
        $routes->get('me', 'Api\\V1\\AuthController::me');
        $routes->post('auth/logout', 'Api\\V1\\AuthController::logout');

        $routes->resource('users', ['controller' => 'Api\\V1\\UsersController']);
        $routes->resource('roles', ['controller' => 'Api\\V1\\RolesController']);

        $routes->put('target-profiles/(:num)/credentials', 'Api\\V1\\CredentialsController::set/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->delete('target-profiles/(:num)/credentials', 'Api\\V1\\CredentialsController::clear/$1', ['filter' => 'role:Owner']);
        $routes->resource('target-profiles', ['controller' => 'Api\\V1\\TargetProfilesController']);

        $routes->post('master-prompts', 'Api\\V1\\MasterPromptsController::create', ['filter' => 'role:Owner,QA Manager']);
        $routes->get('master-prompts', 'Api\\V1\\MasterPromptsController::index');

        $routes->post('session-plans/generate', 'Api\\V1\\SessionPlansController::generate', ['filter' => 'role:Owner,QA Manager']);
        $routes->resource('session-plans', ['controller' => 'Api\\V1\\SessionPlansController']);
        $routes->post('session-plans/(:num)/approve', 'Api\\V1\\SessionPlansController::approve/$1', ['filter' => 'role:Owner,QA Manager']);

        $routes->resource('runs', ['controller' => 'Api\\V1\\RunsController']);
        $routes->resource('sessions', ['controller' => 'Api\\V1\\SessionsController']);

        $routes->resource('test-data-packs', ['controller' => 'Api\\V1\\TestDataPacksController']);
        $routes->resource('validation-rules', ['controller' => 'Api\\V1\\ValidationRulesController']);
        $routes->get('validation-results', 'Api\\V1\\ValidationController::index');

        $routes->resource('error-register', ['controller' => 'Api\\V1\\ErrorRegisterController']);

        $routes->get('reports', 'Api\\V1\\ReportsController::index');
        $routes->get('reports/session/(:num)/html', 'Api\\V1\\ReportsController::sessionHtml/$1');
        $routes->get('reports/session/(:num)/json', 'Api\\V1\\ReportsController::sessionJson/$1');
        $routes->get('reports/(:segment)', 'Api\\V1\\ReportsController::show/$1');
        $routes->get('reports/(:segment)/html', 'Api\\V1\\ReportsController::html/$1');
        $routes->get('reports/(:segment)/json', 'Api\\V1\\ReportsController::json/$1');

        $routes->get('settings', 'Api\\V1\\SettingsController::index', ['filter' => 'role:Owner,QA Manager']);
        $routes->put('settings', 'Api\\V1\\SettingsController::update', ['filter' => 'role:Owner']);

        $routes->get('audit-logs', 'Api\\V1\\AuditLogsController::index');

        $routes->get('dashboard/summary', 'Api\\V1\\DashboardController::summary');
        $routes->get('dashboard/worker-status', 'Api\\V1\\DashboardController::workerStatus');
    });
});
