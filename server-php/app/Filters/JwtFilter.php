<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;
use Config\Services;

class JwtFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $header = $request->getHeaderLine('Authorization');
        if (! preg_match('/^Bearer\\s+(\\S+)$/i', $header, $m)) {
            return service('response')
                ->setStatusCode(401)
                ->setJSON(['ok' => false, 'error' => 'Missing or malformed Authorization header.']);
        }

        $payload = Services::jwt()->decode($m[1]);
        if (! $payload) {
            return service('response')
                ->setStatusCode(401)
                ->setJSON(['ok' => false, 'error' => 'Invalid or expired token.']);
        }

        $request->qaUser = [
            'id'    => (int) $payload['sub'],
            'email' => $payload['email'] ?? '',
            'roles' => array_values($payload['roles'] ?? []),
        ];
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}
