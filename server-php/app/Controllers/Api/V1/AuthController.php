<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\UsersModel;
use App\Services\ConsoleAccess\ConsoleAccessPolicy;
use App\Services\ConsoleAccess\ConsoleRoleSyncService;
use App\Services\ConsoleIdentityService;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Services;
use RuntimeException;
use Throwable;

class AuthController extends BaseApiController
{
    private const QA_TOKEN_STORAGE_KEY = 'qa.token';

    public function login()
    {
        return $this->fail(
            'Local login is disabled. Sign in at console.aicountly.org and open QA from Top Controller Apps.',
            403,
        );
    }

    /**
     * POST /v1/auth/refresh {token} — re-issue a QA token. Before issuing, the
     * user's access is re-confirmed with Console (user-access pull) when
     * CONSOLE_API_URL + CONSOLE_API_TOKEN are configured: revoked access ends
     * every local session; otherwise local roles are replaced with Console's.
     */
    public function refresh()
    {
        $body    = $this->input();
        $token   = (string) ($body['token'] ?? '');
        try {
            $payload = Services::jwt()->decode($token);
        } catch (RuntimeException $e) {
            return $this->fail($e->getMessage(), 503);
        }
        if (! $payload) {
            return $this->fail('Invalid token.', 401);
        }

        $users = new UsersModel();
        $row   = $users->find((int) ($payload['sub'] ?? 0));
        if (! $row || ($row['status'] ?? 'active') !== 'active') {
            return $this->fail('QA user account is inactive.', 401);
        }
        if (ConsoleRoleSyncService::sessionRevoked($row, (int) ($payload['iat'] ?? 0))) {
            return $this->fail('Your QA session was revoked. Sign in again from Console.', 401);
        }

        $decision = Services::consoleRoleSync()->checkAccess($row, true);
        if (! $decision->allowed) {
            $this->audit('console_access_refresh_denied', [
                'actor_id'    => (int) $row['id'],
                'actor_email' => $row['email'],
                'metadata'    => ['source' => $decision->source, 'revoked' => $decision->revoke],
            ]);

            return $this->fail($decision->message, $decision->status);
        }

        $roles = $users->roleCodes((int) $row['id']);
        if ($roles === []) {
            return $this->fail(ConsoleAccessPolicy::NOT_ASSIGNED_MESSAGE, 403);
        }

        $new = Services::jwt()->issue((int) $row['id'], (string) $row['email'], $roles);

        return $this->ok(['token' => $new, 'roles' => $roles]);
    }

    public function logout()
    {
        $this->audit('logout');
        return $this->ok(['message' => 'Logged out.']);
    }

    public function me()
    {
        $u = $this->user();
        if (! $u) {
            return $this->fail('Not authenticated.', 401);
        }
        $users = new UsersModel();
        $row   = $users->find($u['id']);
        return $this->ok([
            'id'              => (int) $row['id'],
            'email'           => $row['email'],
            'name'            => $row['name'],
            'roles'           => $users->roleCodes((int) $row['id']),
            'controller_apps' => $this->controllerAppsForRequest(),
        ]);
    }

    public function controllerAppsLauncher()
    {
        $u = $this->user();
        if (! $u) {
            return $this->fail('Not authenticated.', 401);
        }

        $apps = $this->controllerAppsForRequest();
        if ($apps === []) {
            return $this->fail(
                'Console session required for Top Controller Apps. Sign in at console.aicountly.org first.',
                401,
            );
        }

        return $this->ok(['apps' => $apps]);
    }

    public function ssoLaunchUrl()
    {
        $u = $this->user();
        if (! $u) {
            return $this->fail('Not authenticated.', 401);
        }

        $appCode = strtolower(trim((string) ($this->request->getGet('app_code') ?? '')));
        if ($appCode === '') {
            return $this->fail('app_code query parameter is required.', 422);
        }

        $consoleToken = $this->consoleTokenFromRequest();
        if ($consoleToken === '') {
            return $this->fail('Console session required to launch controller apps.', 401);
        }

        $data = Services::consoleIdentity()->getSsoLaunchUrl($consoleToken, $appCode);
        $redirectUrl = trim((string) ($data['redirect_url'] ?? ''));
        if ($redirectUrl === '') {
            return $this->fail('Console did not return a launch URL for this app.', 502);
        }

        return $this->ok(['redirect_url' => $redirectUrl]);
    }

    /**
     * GET /v1/auth/sso-callback?token= — browser redirect from Console (no SPA JS required).
     */
    public function ssoCallback()
    {
        try {
            if ($fail = $this->ensureJwtConfigured()) {
                return $this->ssoCallbackHtml('QA Portal is not configured for Console SSO yet.', 503);
            }

            $token = trim((string) ($this->request->getGet('token') ?? $this->request->getGet('sesskey') ?? ''));
            if ($token === '') {
                return $this->ssoCallbackHtml('Missing SSO token. Open QA again from Console Top Controller Apps.', 400);
            }

            $identity = Services::consoleIdentity()->exchangeLaunchToken($token);
            if ($identity === null) {
                return $this->ssoCallbackHtml(
                    'This sign-in link expired. Go back to Console and click QA again.',
                    401,
                );
            }

            $session = $this->buildSessionFromConsoleIdentity($identity, 'controller_sso_callback');
            if ($session instanceof ResponseInterface) {
                $message = 'You do not have access to the QA controller app.';
                $json    = json_decode((string) $session->getBody(), true);
                if (is_array($json) && ! empty($json['error'])) {
                    $message = (string) $json['error'];
                }

                return $this->ssoCallbackHtml($message, 403);
            }

            return $this->completeSsoInBrowser((string) $session['token']);
        } catch (Throwable $e) {
            log_message('error', 'SSO callback failed: ' . $e->getMessage());

            return $this->ssoCallbackHtml('Console SSO sign-in failed. Try again from Console.', 500);
        }
    }

    /**
     * Exchange a Console controller SSO launch token for a QA session.
     */
    public function controllerSso()
    {
        try {
            if ($fail = $this->ensureJwtConfigured()) {
                return $fail;
            }

            $body  = $this->input();
            $token = trim((string) ($body['token'] ?? ''));
            if ($token === '') {
                return $this->fail('token required.', 400);
            }

            $identity = Services::consoleIdentity()->exchangeLaunchToken($token);
            if ($identity === null) {
                return $this->fail('Invalid or expired Console SSO token.', 401);
            }

            $session = $this->buildSessionFromConsoleIdentity($identity, 'controller_sso_login');
            if ($session instanceof ResponseInterface) {
                return $session;
            }

            return $this->ok($session);
        } catch (Throwable $e) {
            log_message('error', 'Controller SSO failed: ' . $e->getMessage());

            return $this->fail('Controller SSO login failed.', 500);
        }
    }

    /**
     * Sign in using the shared Console cookie (direct visit to qa.aicountly.org).
     */
    public function consoleSession()
    {
        try {
            if ($fail = $this->ensureJwtConfigured()) {
                return $fail;
            }

            $consoleToken = trim((string) ($this->request->getCookie(ConsoleIdentityService::cookieName()) ?? ''));
            if ($consoleToken === '') {
                return $this->fail('Sign in to Console first.', 401);
            }

            $identity = Services::consoleIdentity()->introspectSession($consoleToken);
            if ($identity === null) {
                return $this->fail('Console session is invalid or expired. Sign in again at Console.', 401);
            }

            $session = $this->buildSessionFromConsoleIdentity($identity, 'console_session_login');
            if ($session instanceof ResponseInterface) {
                return $session;
            }

            return $this->ok($session);
        } catch (Throwable $e) {
            log_message('error', 'Console session login failed: ' . $e->getMessage());

            return $this->fail('Console session login failed.', 500);
        }
    }

    /**
     * Console decides QA roles. With `app_roles` in the payload the user's
     * local roles are replaced with exactly those (superadmin => every role);
     * an empty list is refused. Without `app_roles` (old Console) existing
     * roles are kept and only a superadmin may be seeded with Owner.
     *
     * @param array<string,mixed> $identity
     * @return array<string,mixed>|ResponseInterface
     */
    private function buildSessionFromConsoleIdentity(array $identity, string $auditEvent): array|ResponseInterface
    {
        $active = (bool) ($identity['active'] ?? false);
        if (! $active) {
            return $this->fail('You do not have access to the QA controller app.', 403);
        }

        $global = (bool) ($identity['global_superadmin'] ?? false);

        $consoleUser = is_array($identity['user'] ?? null) ? $identity['user'] : [];
        $email = strtolower(trim((string) ($consoleUser['email'] ?? '')));
        $name  = trim((string) ($consoleUser['name'] ?? ''));
        if ($email === '') {
            return $this->fail('Console identity did not return a user email.', 502);
        }

        $sync     = Services::consoleRoleSync();
        $decision = $sync->decideLogin($identity);
        $users    = new UsersModel();
        $user     = $users->findByEmail($email);

        if (! $decision->allowed) {
            if ($user) {
                $sync->revokeLocalAccess((int) $user['id']);
                $this->audit('console_access_denied', [
                    'actor_id'    => (int) $user['id'],
                    'actor_email' => $user['email'],
                    'metadata'    => ['reason' => 'no_app_roles', 'event' => $auditEvent],
                ]);
            }

            return $this->fail($decision->message, $decision->status);
        }

        if (! $user) {
            $userId = $users->insert([
                'email'         => $email,
                'name'          => $name !== '' ? $name : $email,
                'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
                'status'        => 'active',
            ]);

            if (! $userId) {
                return $this->fail('Could not provision QA user from Console identity.', 500);
            }

            $user = $users->find((int) $userId);
        } elseif (($user['status'] ?? 'active') !== 'active') {
            return $this->fail('QA user account is inactive.', 403);
        }

        $sync->applyLogin((int) $user['id'], $decision);
        $roles = $users->roleCodes((int) $user['id']);
        if ($roles === []) {
            return $this->fail(ConsoleAccessPolicy::NOT_ASSIGNED_MESSAGE, 403);
        }

        try {
            $qaToken = Services::jwt()->issue((int) $user['id'], $user['email'], $roles);
        } catch (RuntimeException $e) {
            return $this->fail($e->getMessage(), 503);
        }

        $users->update($user['id'], [
            'last_login_at'   => date('Y-m-d H:i:s'),
            'last_login_ip'   => $this->request->getIPAddress(),
            'failed_attempts' => 0,
        ]);

        $this->audit($auditEvent, [
            'actor_id'    => (int) $user['id'],
            'actor_email' => $user['email'],
            'actor_role'  => $roles[0] ?? null,
            'metadata'    => [
                'console_user_id'   => $decision->consoleUserId ?? (int) ($consoleUser['id'] ?? 0),
                'global_superadmin' => $global,
                'app_superadmin'    => (bool) ($identity['app_superadmin'] ?? false),
                'roles_source'      => $decision->source,
                'roles'             => $roles,
                'authz_version'     => $decision->authzVersion,
            ],
        ]);

        return [
            'token'   => $qaToken,
            'expires' => (int) env('QA_JWT_TTL_MINUTES', 720) * 60,
            'user'    => [
                'id'              => (int) $user['id'],
                'email'           => $user['email'],
                'name'            => $user['name'],
                'roles'           => $roles,
                'controller_apps' => $this->normalizeLauncherApps(
                    is_array($identity['controller_apps'] ?? null) ? $identity['controller_apps'] : [],
                ),
            ],
        ];
    }

    private function controllerAppsForRequest(): array
    {
        $consoleToken = $this->consoleTokenFromRequest();
        if ($consoleToken === '') {
            return [];
        }

        $data = Services::consoleIdentity()->getLauncherApps($consoleToken);
        if (! is_array($data)) {
            return [];
        }

        return $this->normalizeLauncherApps(
            is_array($data['apps'] ?? null) ? $data['apps'] : [],
        );
    }

    private function consoleTokenFromRequest(): string
    {
        return trim((string) ($this->request->getCookie(ConsoleIdentityService::cookieName()) ?? ''));
    }

    private function normalizeLauncherApps(array $apps): array
    {
        $current = strtolower(trim((string) env('CONTROLLER_APP_CODE', 'qa')));

        return array_values(array_map(static function (array $app) use ($current): array {
            $code = strtolower(trim((string) ($app['code'] ?? '')));
            $app['is_current'] = $code === $current;

            return $app;
        }, $apps));
    }

    private function completeSsoInBrowser(string $qaToken): ResponseInterface
    {
        $tokenJson = json_encode($qaToken, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);
        $storageKey = json_encode(self::QA_TOKEN_STORAGE_KEY, JSON_THROW_ON_ERROR | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP);
        $html = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Signing in to QA Portal…</title>
  <style>
    body { font-family: system-ui, sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; color: #334155; }
  </style>
</head>
<body>
  <p>Signing you in to QA Portal…</p>
  <script>
    try {
      localStorage.setItem({$storageKey}, {$tokenJson});
    } catch (e) {}
    location.replace('/');
  </script>
</body>
</html>
HTML;

        return $this->response
            ->setStatusCode(200)
            ->setContentType('text/html')
            ->setBody($html);
    }

    private function ssoCallbackHtml(string $message, int $status = 400): ResponseInterface
    {
        $safeMessage = htmlspecialchars($message, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
        $consoleUrl  = 'https://console.aicountly.org';
        $html = <<<HTML
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QA sign-in failed</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 420px; margin: 48px auto; padding: 0 16px; color: #334155; }
    .box { border: 1px solid #fecaca; background: #fef2f2; border-radius: 12px; padding: 16px; }
    a { color: #047857; }
  </style>
</head>
<body>
  <div class="box">
    <h1 style="font-size:18px;margin:0 0 8px;">QA sign-in failed</h1>
    <p style="margin:0 0 12px;">{$safeMessage}</p>
    <p style="margin:0;"><a href="{$consoleUrl}">Return to Console</a></p>
  </div>
</body>
</html>
HTML;

        return $this->response
            ->setStatusCode($status)
            ->setContentType('text/html')
            ->setBody($html);
    }

    private function ensureJwtConfigured(): ?ResponseInterface
    {
        $jwtSecret = (string) env('QA_JWT_SECRET', '');
        if ($jwtSecret === '' || strlen($jwtSecret) < 32) {
            return $this->fail(
                'Server misconfigured: set QA_JWT_SECRET (32+ chars) in api/.env',
                503
            );
        }

        return null;
    }
}
