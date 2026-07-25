<?php

namespace App\Controllers\Api\V1;

use App\Models\ErrorRegisterModel;
use CodeIgniter\RESTful\ResourceController;

class ErrorRegisterController extends ResourceController
{
    protected $modelName = ErrorRegisterModel::class;
    protected $format    = 'json';

    public function index()
    {
        $q = $this->request->getGet();
        if (! empty($q['severity'])) { $this->model->where('severity', $q['severity']); }
        if (! empty($q['product']))  { $this->model->where('product_name', $q['product']); }
        if (! empty($q['module']))   { $this->model->where('module', $q['module']); }
        if (! empty($q['status']))   { $this->model->where('status', $q['status']); }
        $rows = $this->model->orderBy('last_seen_at', 'DESC')->limit(500)->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    public function update($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }

        $body   = $this->request->getJSON(true);
        $body   = is_array($body) ? $body : [];
        $status = (string) ($body['status'] ?? '');
        if (! in_array($status, ['open', 'investigating', 'closed'], true)) {
            return $this->fail('Status must be open, investigating, or closed.', 400);
        }

        $this->model->update((int) $id, ['status' => $status]);

        return $this->respond([
            'ok'   => true,
            'data' => $this->model->find($id),
        ]);
    }
}
