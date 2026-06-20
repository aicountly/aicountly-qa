<?php

namespace App\Controllers\Api\V1;

use App\Models\RolesModel;
use CodeIgniter\RESTful\ResourceController;

class RolesController extends ResourceController
{
    protected $modelName = RolesModel::class;
    protected $format    = 'json';

    public function index()
    {
        return $this->respond(['ok' => true, 'data' => $this->model->orderBy('id')->findAll()]);
    }
}
