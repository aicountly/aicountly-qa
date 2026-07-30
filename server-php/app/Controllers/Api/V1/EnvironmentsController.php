<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use Config\Environments;

/**
 * Serves the environment tier catalogue so the portal renders labels and
 * capability badges from one source of truth instead of a hardcoded list.
 */
class EnvironmentsController extends BaseApiController
{
    public function index()
    {
        return $this->ok([
            'default'      => Environments::DEFAULT,
            'environments' => Environments::catalog(),
            'legacy_map'   => Environments::LEGACY_MAP,
        ]);
    }
}
