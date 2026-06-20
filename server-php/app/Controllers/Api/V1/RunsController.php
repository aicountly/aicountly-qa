<?php

namespace App\Controllers\Api\V1;

use App\Models\RunsModel;
use App\Models\SessionsModel;
use CodeIgniter\RESTful\ResourceController;

class RunsController extends ResourceController
{
    protected $modelName = RunsModel::class;
    protected $format    = 'json';

    public function index()
    {
        $q = $this->request->getGet();
        if (! empty($q['product']))     { $this->model->where('product_name', $q['product']); }
        if (! empty($q['environment'])) { $this->model->where('environment', $q['environment']); }
        if (! empty($q['status']))      { $this->model->where('status', $q['status']); }
        if (! empty($q['from']))        { $this->model->where('started_at >=', $q['from']); }
        if (! empty($q['to']))          { $this->model->where('started_at <=', $q['to']); }

        $rows = $this->model->orderBy('created_at', 'DESC')->limit(100)->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    public function show($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $sessions = (new SessionsModel())->where('qa_run_id', $id)->orderBy('order_index')->findAll();
        $row['sessions'] = $sessions;
        return $this->respond(['ok' => true, 'data' => $row]);
    }
}
