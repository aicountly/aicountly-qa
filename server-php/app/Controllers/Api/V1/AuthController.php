<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\UsersModel;
use Config\Services;
use RuntimeException;
use Throwable;

class AuthController extends BaseApiController
{
    public function login()
    {
        try {
            $jwtSecret = (string) env('QA_JWT_SECRET', '');
            if ($jwtSecret === '' || strlen($jwtSecret) < 32) {
                return $this->fail(
                    'Server misconfigured: set QA_JWT_SECRET (32+ chars) in api/.env',
                    503
                );
            }

            $body  = $this->input();
            $email = trim((string) ($body['email'] ?? ''));
            $pass  = (string) ($body['password'] ?? '');

            if ($email === '' || $pass === '') {
                return $this->fail('email and password required.', 400);
            }

            $users = new UsersModel();
            $user  = $users->findByEmail($email);

            if (! $user || ($user['status'] ?? 'active') !== 'active') {
                return $this->fail('Invalid credentials.', 401);
            }

            $hash = (string) ($user['password_hash'] ?? '');
            if ($hash === '' || ! password_verify($pass, $hash)) {
                if ($hash !== '') {
                    $users->update($user['id'], ['failed_attempts' => ((int) ($user['failed_attempts'] ?? 0)) + 1]);
                }
                return $this->fail('Invalid credentials.', 401);
            }

            $roles = $users->roleCodes((int) $user['id']);
            try {
                $token = Services::jwt()->issue((int) $user['id'], $user['email'], $roles);
            } catch (RuntimeException $e) {
                return $this->fail($e->getMessage(), 503);
            }

            $users->update($user['id'], [
                'last_login_at'   => date('Y-m-d H:i:s'),
                'last_login_ip'   => $this->request->getIPAddress(),
                'failed_attempts' => 0,
            ]);

            $this->audit('login', [
                'actor_id'    => (int) $user['id'],
                'actor_email' => $user['email'],
                'actor_role'  => $roles[0] ?? null,
                'metadata'    => ['roles' => $roles],
            ]);

            return $this->ok([
                'token'   => $token,
                'expires' => (int) env('QA_JWT_TTL_MINUTES', 720) * 60,
                'user'    => [
                    'id'    => (int) $user['id'],
                    'email' => $user['email'],
                    'name'  => $user['name'],
                    'roles' => $roles,
                ],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'Login failed: ' . $e->getMessage());

            return $this->fail('Login failed. Check api/writable/logs on the server.', 500);
        }
    }

    public function refresh()
    {
        $body  = $this->input();
        $token = (string) ($body['token'] ?? '');
        $payload = Services::jwt()->decode($token);
        if (! $payload) {
            return $this->fail('Invalid token.', 401);
        }
        $new = Services::jwt()->issue(
            (int) $payload['sub'],
            (string) ($payload['email'] ?? ''),
            (array) ($payload['roles'] ?? [])
        );
        return $this->ok(['token' => $new]);
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
            'id'    => (int) $row['id'],
            'email' => $row['email'],
            'name'  => $row['name'],
            'roles' => $users->roleCodes((int) $row['id']),
        ]);
    }

    /**
     * Exchange a Console controller SSO launch token for a QA session.
     */
    public function controllerSso()
    {
        try {
            $jwtSecret = (string) env('QA_JWT_SECRET', '');
            if ($jwtSecret === '' || strlen($jwtSecret) < 32) {
                return $this->fail(
                    'Server misconfigured: set QA_JWT_SECRET (32+ chars) in api/.env',
                    503
                );
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

            $active = (bool) ($identity['active'] ?? false);
            $global = (bool) ($identity['global_superadmin'] ?? false);
            if (! $active && ! $global) {
                return $this->fail('You do not have access to the QA controller app.', 403);
            }

            $consoleUser = is_array($identity['user'] ?? null) ? $identity['user'] : [];
            $email = strtolower(trim((string) ($consoleUser['email'] ?? '')));
            $name  = trim((string) ($consoleUser['name'] ?? ''));
            if ($email === '') {
                return $this->fail('Console SSO did not return a user email.', 502);
            }

            $users = new UsersModel();
            $user  = $users->findByEmail($email);

            if (! $user) {
                $userId = $users->insert([
                    'email'         => $email,
                    'name'          => $name !== '' ? $name : $email,
                    'password_hash' => password_hash(bin2hex(random_bytes(16)), PASSWORD_BCRYPT),
                    'status'        => 'active',
                ]);

                if (! $userId) {
                    return $this->fail('Could not provision QA user from Console SSO.', 500);
                }

                $this->assignRoleByCode($users, (int) $userId, $global ? 'Owner' : 'Developer Viewer');
                $user = $users->find((int) $userId);
            } elseif (($user['status'] ?? 'active') !== 'active') {
                return $this->fail('QA user account is inactive.', 403);
            }

            $roles = $users->roleCodes((int) $user['id']);
            if ($roles === [] && $global) {
                $this->assignRoleByCode($users, (int) $user['id'], 'Owner');
                $roles = $users->roleCodes((int) $user['id']);
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

            $this->audit('controller_sso_login', [
                'actor_id'    => (int) $user['id'],
                'actor_email' => $user['email'],
                'actor_role'  => $roles[0] ?? null,
                'metadata'    => [
                    'console_user_id'     => (int) ($consoleUser['id'] ?? 0),
                    'global_superadmin'   => $global,
                ],
            ]);

            return $this->ok([
                'token'   => $qaToken,
                'expires' => (int) env('QA_JWT_TTL_MINUTES', 720) * 60,
                'user'    => [
                    'id'    => (int) $user['id'],
                    'email' => $user['email'],
                    'name'  => $user['name'],
                    'roles' => $roles,
                ],
            ]);
        } catch (Throwable $e) {
            log_message('error', 'Controller SSO failed: ' . $e->getMessage());

            return $this->fail('Controller SSO login failed.', 500);
        }
    }

    private function assignRoleByCode(UsersModel $users, int $userId, string $roleCode): void
    {
        $db = $users->db;
        $role = $db->table('qa_roles')->where('code', $roleCode)->get()->getRow();
        if (! $role) {
            return;
        }

        $exists = $db->table('qa_user_roles')
            ->where('user_id', $userId)
            ->where('role_id', $role->id)
            ->countAllResults() > 0;

        if ($exists) {
            return;
        }

        $db->table('qa_user_roles')->insert([
            'user_id'    => $userId,
            'role_id'    => $role->id,
            'created_at' => date('Y-m-d H:i:s'),
        ]);
    }
}
