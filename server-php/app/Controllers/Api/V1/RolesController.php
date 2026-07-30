<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\RolesModel;

class RolesController extends BaseResourceApiController
{
    protected $modelName = RolesModel::class;
    protected $format    = 'json';

    public function index()
    {
        return $this->respond(['ok' => true, 'data' => $this->model->orderBy('id')->findAll()]);
    }
}
