<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\UsersModel;
use Config\Services;

class AuthController extends BaseApiController
{
    public function login()
    {
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

        if (! password_verify($pass, $user['password_hash'])) {
            $users->update($user['id'], ['failed_attempts' => ((int) ($user['failed_attempts'] ?? 0)) + 1]);
            return $this->fail('Invalid credentials.', 401);
        }

        $roles = $users->roleCodes((int) $user['id']);
        $token = Services::jwt()->issue((int) $user['id'], $user['email'], $roles);

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
}
