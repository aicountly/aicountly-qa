<?php

namespace App\Controllers\Api\V1;

use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\ValidationResultsModel;
use CodeIgniter\RESTful\ResourceController;

class SessionsController extends ResourceController
{
    protected $modelName = SessionsModel::class;
    protected $format    = 'json';

    public function index()
    {
        $q = $this->request->getGet();
        if (! empty($q['qa_run_id'])) { $this->model->where('qa_run_id', $q['qa_run_id']); }
        if (! empty($q['status']))    { $this->model->where('status', $q['status']); }
        if (! empty($q['module']))    { $this->model->where('module', $q['module']); }
        $rows = $this->model->orderBy('qa_run_id', 'DESC')->orderBy('order_index')->limit(500)->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    public function show($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $row['result']      = (new SessionResultsModel())->where('session_id', $id)->first();
        $row['validations'] = (new ValidationResultsModel())->where('session_id', $id)->findAll();
        return $this->respond(['ok' => true, 'data' => $row]);
    }
}
