<?php

namespace App\Controllers;

use CodeIgniter\HTTP\ResponseInterface;
use CodeIgniter\RESTful\ResourceController;

/**
 * ResourceController with the same failure envelope as BaseApiController.
 *
 * CI4's ResponseTrait::fail() answers `{status, error: <http status>, messages}`,
 * so a hand-written message ends up in `messages.error` while `error` holds the
 * numeric status. The portal reads `response.data.error` everywhere, which meant
 * a 409 from a resource controller rendered as the string "409" instead of the
 * reason. Overriding fail() normalises every helper that funnels through it —
 * failNotFound, failForbidden, failValidationErrors and friends included.
 */
abstract class BaseResourceApiController extends ResourceController
{
    protected $format = 'json';

    /**
     * @param array<array-key, string>|string $messages
     *
     * @return ResponseInterface
     */
    protected function fail($messages, int $status = 400, ?string $code = null, string $customMessage = '')
    {
        $list = is_array($messages) ? $messages : ['error' => $messages];
        $text = implode(' ', array_map(static fn ($m): string => trim((string) $m), $list));

        return $this->respond([
            'ok'       => false,
            'error'    => $text !== '' ? $text : (string) $status,
            'status'   => $status,
            'code'     => $code ?? (string) $status,
            'messages' => $list,
        ], $status, $customMessage);
    }
}
