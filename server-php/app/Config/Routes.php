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
    $consoleOk = trim((string) env('CONSOLE_API_URL', '')) !== '';

    return service('response')->setJSON([
        'ok'        => $jwtOk && $consoleOk,
        'service'   => 'aicountly-qa-api',
        'status'    => ($jwtOk && $consoleOk) ? 'ready' : 'misconfigured',
        'timestamp' => gmdate('c'),
        'sso'       => [
            'console_identity' => 'sso-callback-v2',
            'routes'           => ['sso-callback', 'controller-sso', 'console-session'],
        ],
        'checks'    => [
            'jwt_secret'      => $jwtOk ? 'ok' : 'missing or too short (need 32+ chars in api/.env)',
            'vault_key'       => $vaultOk ? 'ok' : 'missing or too short',
            'console_api_url' => $consoleOk ? 'ok' : 'missing CONSOLE_API_URL in api/.env',
        ],
    ]);
});

$routes->group('v1', static function ($routes) {
    // Public auth endpoints — no JWT.
    $routes->post('auth/login', 'Api\\V1\\AuthController::login');
    $routes->get('auth/sso-callback', 'Api\\V1\\AuthController::ssoCallback');
    $routes->post('auth/controller-sso', 'Api\\V1\\AuthController::controllerSso');
    $routes->post('auth/console-session', 'Api\\V1\\AuthController::consoleSession');
    $routes->post('auth/refresh', 'Api\\V1\\AuthController::refresh');

    // Worker endpoints — separate worker token (long-lived), not user JWT.
    $routes->group('worker', ['filter' => 'worker-auth'], static function ($routes) {
        $routes->get('next-session', 'Api\\V1\\WorkerController::nextSession');
        $routes->post('ping', 'Api\\V1\\WorkerController::ping');
        $routes->post('sessions/(:num)/claim', 'Api\\V1\\WorkerController::claim/$1');
        $routes->post('sessions/(:num)/heartbeat', 'Api\\V1\\WorkerController::heartbeat/$1');
        $routes->post('sessions/(:num)/progress', 'Api\\V1\\WorkerController::progress/$1');
        $routes->post('sessions/(:num)/result', 'Api\\V1\\WorkerController::postResult/$1');
        $routes->post('sessions/(:num)/evidence', 'Api\\V1\\WorkerController::uploadEvidence/$1');
        $routes->post('sessions/(:num)/file-io', 'Api\\V1\\WorkerController::postFileIo/$1');
        $routes->post('file-io/(:num)/artifact', 'Api\\V1\\WorkerController::uploadFileIoArtifact/$1');
        $routes->post('sessions/(:num)/feature-gaps', 'Api\\V1\\WorkerController::postFeatureGaps/$1');
        $routes->get('credentials/(:num)', 'Api\\V1\\WorkerController::credentials/$1');
        $routes->post('decisions', 'Api\\V1\\WorkerController::createDecision');
        $routes->get('decisions/(:num)', 'Api\\V1\\WorkerController::decision/$1');
        $routes->post('decisions/(:num)/timeout', 'Api\\V1\\WorkerController::timeoutDecision/$1');
        $routes->get('decision-memory', 'Api\\V1\\WorkerController::decisionMemory');
        $routes->post('brain/invoke', 'Api\\V1\\WorkerController::brainInvoke');
        $routes->get('brain/health', 'Api\\V1\\WorkerController::brainHealth');
    });

    // Authenticated portal endpoints.
    $routes->group('', ['filter' => 'jwt'], static function ($routes) {
        $routes->get('me', 'Api\\V1\\AuthController::me');
        $routes->post('auth/logout', 'Api\\V1\\AuthController::logout');
        $routes->get('auth/controller-apps/launcher', 'Api\\V1\\AuthController::controllerAppsLauncher');
        $routes->get('auth/sso/launch-url', 'Api\\V1\\AuthController::ssoLaunchUrl');

        $routes->resource('users', ['controller' => 'Api\\V1\\UsersController']);
        $routes->resource('roles', ['controller' => 'Api\\V1\\RolesController']);

        $routes->put('target-profiles/(:num)/credentials', 'Api\\V1\\CredentialsController::set/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->delete('target-profiles/(:num)/credentials', 'Api\\V1\\CredentialsController::clear/$1', ['filter' => 'role:Owner']);
        $routes->resource('target-profiles', ['controller' => 'Api\\V1\\TargetProfilesController']);

        $routes->get('environments', 'Api\\V1\\EnvironmentsController::index');

        $routes->get('master-prompts-samples', 'Api\\V1\\MasterPromptsController::samples');
        $routes->post('master-prompts', 'Api\\V1\\MasterPromptsController::create', ['filter' => 'role:Owner,QA Manager']);
        $routes->get('master-prompts', 'Api\\V1\\MasterPromptsController::index');

        $routes->post('session-plans/generate', 'Api\\V1\\SessionPlansController::generate', ['filter' => 'role:Owner,QA Manager']);
        $routes->resource('session-plans', ['controller' => 'Api\\V1\\SessionPlansController']);
        $routes->post('session-plans/(:num)/approve', 'Api\\V1\\SessionPlansController::approve/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->post('session-plans/(:num)/reject', 'Api\\V1\\SessionPlansController::reject/$1', ['filter' => 'role:Owner,QA Manager']);

        $routes->get('runs/(:segment)/decisions', 'Api\\V1\\DecisionsController::index/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->post('runs/(:segment)/decisions/(:num)/answer', 'Api\\V1\\DecisionsController::answer/$1/$2', ['filter' => 'role:Owner,QA Manager']);
        $routes->get('runs/(:segment)/decisions/(:num)/screenshot', 'Api\\V1\\DecisionsController::screenshot/$1/$2', ['filter' => 'role:Owner,QA Manager']);
        $routes->post('runs/(:segment)/cancel', 'Api\\V1\\RunsController::cancel/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->get('runs/(:segment)/file-io', 'Api\\V1\\RunsController::fileIo/$1');
        $routes->get('runs/(:segment)/file-io/(:num)/artifact/(:segment)', 'Api\\V1\\RunsController::fileIoArtifact/$1/$2/$3');
        $routes->resource('runs', ['controller' => 'Api\\V1\\RunsController']);
        $routes->get('sessions/(:num)/live', 'Api\\V1\\SessionsController::live/$1');
        // Prefer query ?filename=… — path URLs ending in .png are often intercepted by
        // cPanel/nginx static-file rules before CodeIgniter runs.
        $routes->get('sessions/(:num)/evidence', 'Api\\V1\\SessionsController::evidence/$1');
        $routes->get('sessions/(:num)/evidence/(:segment)', 'Api\\V1\\SessionsController::evidence/$1/$2');
        $routes->post('sessions/(:num)/rerun', 'Api\\V1\\SessionsController::rerun/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->resource('sessions', ['controller' => 'Api\\V1\\SessionsController']);

        $routes->resource('test-data-packs', ['controller' => 'Api\\V1\\TestDataPacksController']);
        $routes->resource('validation-rules', ['controller' => 'Api\\V1\\ValidationRulesController']);
        $routes->get('validation-results', 'Api\\V1\\ValidationController::index');

        $routes->resource('error-register', [
            'controller' => 'Api\\V1\\ErrorRegisterController',
            'only'       => ['index', 'show', 'update'],
        ]);
        $routes->patch('error-register/(:num)', 'Api\\V1\\ErrorRegisterController::update/$1', ['filter' => 'role:Owner,QA Manager']);
        $routes->delete('error-register/clear', 'Api\\V1\\ErrorRegisterController::clear', ['filter' => 'role:Owner']);
        $routes->delete('error-register/(:num)', 'Api\\V1\\ErrorRegisterController::delete/$1', ['filter' => 'role:Owner']);

        $routes->get('reports', 'Api\\V1\\ReportsController::index');
        $routes->get('reports/session/(:num)/html', 'Api\\V1\\ReportsController::sessionHtml/$1');
        $routes->get('reports/session/(:num)/json', 'Api\\V1\\ReportsController::sessionJson/$1');
        $routes->get('reports/session/(:num)/prompts', 'Api\\V1\\ReportsController::sessionPrompts/$1');
        $routes->get('reports/(:segment)', 'Api\\V1\\ReportsController::show/$1');
        $routes->get('reports/(:segment)/html', 'Api\\V1\\ReportsController::html/$1');
        $routes->get('reports/(:segment)/json', 'Api\\V1\\ReportsController::json/$1');
        $routes->get('reports/(:segment)/prompts', 'Api\\V1\\ReportsController::prompts/$1');

        $routes->get('settings', 'Api\\V1\\SettingsController::index', ['filter' => 'role:Owner,QA Manager']);
        $routes->put('settings', 'Api\\V1\\SettingsController::update', ['filter' => 'role:Owner']);
        $routes->get('settings/brain-health', 'Api\\V1\\SettingsController::brainHealth', ['filter' => 'role:Owner,QA Manager']);

        $routes->get('audit-logs', 'Api\\V1\\AuditLogsController::index');

        $routes->get('dashboard/summary', 'Api\\V1\\DashboardController::summary');
        $routes->get('dashboard/worker-status', 'Api\\V1\\DashboardController::workerStatus');
    });
});
