<?php

namespace App\Filters;

use CodeIgniter\Filters\FilterInterface;
use CodeIgniter\HTTP\RequestInterface;
use CodeIgniter\HTTP\ResponseInterface;

/**
 * Long-lived shared-secret authentication for the Playwright worker.
 *
 * Worker sends header:  X-Worker-Token: <QA_WORKER_TOKEN>
 * Constant-time comparison; never logs the secret.
 */
class WorkerAuthFilter implements FilterInterface
{
    public function before(RequestInterface $request, $arguments = null)
    {
        $expected = (string) env('QA_WORKER_TOKEN', '');
        $provided = (string) $request->getHeaderLine('X-Worker-Token');

        if ($expected === '' || $provided === '' || ! hash_equals($expected, $provided)) {
            return service('response')->setStatusCode(401)->setJSON([
                'ok'    => false,
                'error' => 'Invalid worker token.',
            ]);
        }
    }

    public function after(RequestInterface $request, ResponseInterface $response, $arguments = null)
    {
    }
}
