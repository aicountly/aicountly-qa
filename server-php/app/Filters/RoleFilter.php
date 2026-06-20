<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Usage in Routes.php:
 *   $routes->get('settings', '...', ['filter' => 'role:Owner,QA Manager']);
 *
 * The filter expects request->qaUser populated by JwtFilter.
 */
class RoleFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $user = $request->qaUser ?? null;
        if (! $user) {
            return service('response')->setStatusCode(401)->setJSON(['ok' => false, 'error' => 'Not authenticated.']);
        }

        $allowed = array_values(array_filter($arguments ?? []));
        if ($allowed === []) {
            return; // no role requirement
        }

        $userRoles = array_values($user['roles'] ?? []);
        $ok = (bool) array_intersect($allowed, $userRoles);

        if (! $ok) {
            return service('response')
                ->setStatusCode(403)
                ->setJSON([
                    'ok'       => false,
                    'error'    => 'Forbidden — insufficient role.',
                    'required' => $allowed,
                    'present'  => $userRoles,
                ]);
        }
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}
