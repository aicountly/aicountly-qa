<?php

namespace App\Filters;

use App\Models\UsersModel;
use App\Services\ConsoleAccess\ConsoleRoleSyncService;
use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Services;

/**
 * Validates the QA JWT, then checks the user against the database so Console
 * role changes and revocations apply without waiting for the token to expire:
 *
 *  - the user must still exist and be active, and the token must not predate
 *    sessions_revoked_at (set when Console revokes access);
 *  - once roles_synced_at is older than QA_CONSOLE_RECHECK_MINUTES (default
 *    15) the user's access is re-confirmed with Console (needs CONSOLE_API_URL
 *    + CONSOLE_API_TOKEN), replacing local roles or refusing the request;
 *  - the roles attached to the request are the user's current local roles,
 *    not the ones frozen into the token.
 */
class JwtFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $header = $request->getHeaderLine('Authorization');
        if (! preg_match('/^Bearer\\s+(\\S+)$/i', $header, $m)) {
            return $this->reject(401, 'Missing or malformed Authorization header.');
        }

        $payload = null;
        try {
            $payload = Services::jwt()->decode($m[1]);
        } catch (\Throwable $e) {
            return $this->reject(503, 'Server misconfigured: QA_JWT_SECRET in api/.env');
        }
        if (! $payload) {
            return $this->reject(401, 'Invalid or expired token.');
        }

        $userId = (int) ($payload['sub'] ?? 0);
        $users  = new UsersModel();
        $row    = $userId > 0 ? $users->find($userId) : null;
        if (! $row || ($row['status'] ?? 'active') !== 'active') {
            return $this->reject(401, 'QA user account is inactive or no longer exists.');
        }
        if (ConsoleRoleSyncService::sessionRevoked($row, (int) ($payload['iat'] ?? 0))) {
            return $this->reject(401, 'Your QA session was revoked. Sign in again from Console.');
        }

        $decision = Services::consoleRoleSync()->checkAccess($row, false);
        if (! $decision->allowed) {
            return $this->reject($decision->status, $decision->message);
        }

        $request->qaUser = [
            'id'    => $userId,
            'email' => $row['email'] ?? ($payload['email'] ?? ''),
            'roles' => $users->roleCodes($userId),
        ];
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }

    private function reject(int $status, string $message): ResponseInterface
    {
        return service('response')
            ->setStatusCode($status)
            ->setJSON(['ok' => false, 'error' => $message]);
    }
}
