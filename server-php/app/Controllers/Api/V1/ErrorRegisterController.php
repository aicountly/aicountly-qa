<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\ErrorRegisterModel;
use Config\Services;

class ErrorRegisterController extends BaseResourceApiController
{
    protected $modelName = ErrorRegisterModel::class;
    protected $format    = 'json';

    public function index()
    {
        $q = $this->request->getGet();
        if (! empty($q['severity'])) { $this->model->where('severity', $q['severity']); }
        if (! empty($q['module']))   { $this->model->where('module', $q['module']); }
        if (! empty($q['status']))   { $this->model->where('status', $q['status']); }

        // `product` is what the portal filters send; `product_name` matches clear().
        $product = trim((string) ($q['product'] ?? $q['product_name'] ?? ''));
        if ($product !== '') {
            $this->model->where('product_name', $product);
        }

        $this->scopeToRun(trim((string) ($q['qa_run_id'] ?? '')));

        $rows = $this->model->orderBy('last_seen_at', 'DESC')->limit(500)->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    /**
     * A signature can be first seen on one run and last seen on another, so a run
     * filter has to match either end — the same rule the portal applies client side
     * in lib/errorRegister.js, and the rule clear() reuses so that clearing a run
     * removes exactly the rows the run page listed.
     */
    private function scopeToRun(string $runId): void
    {
        if ($runId === '') {
            return;
        }

        $this->model
            ->groupStart()
                ->where('last_seen_run_id', $runId)
                ->orWhere('first_seen_run_id', $runId)
            ->groupEnd();
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

    public function delete($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden('Only an Owner can delete an error register entry.');
        }
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }

        $this->model->delete((int) $id);
        Services::auditService()->log('error_register_delete', [
            'subject_kind' => 'error_register',
            'subject_id'   => $id,
            'metadata'     => ['title' => $row['title'] ?? null],
        ]);

        return $this->respondDeleted(['ok' => true]);
    }

    /**
     * Bulk clear, scoped by run, product, module, or status.
     * At least one scope is required — this never wipes the whole register blind.
     */
    public function clear()
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden('Only an Owner can clear the error register.');
        }

        $body = $this->request->getJSON(true);
        $body = is_array($body) ? $body : [];
        $scope = [];
        foreach (['qa_run_id', 'product_name', 'module', 'status'] as $key) {
            $value = trim((string) ($body[$key] ?? $this->request->getGet($key) ?? ''));
            if ($value !== '') {
                $scope[$key] = $value;
            }
        }

        if ($scope === []) {
            return $this->fail(
                'Provide at least one scope: qa_run_id, product_name, module, or status.',
                400
            );
        }

        foreach ($scope as $key => $value) {
            if ($key === 'qa_run_id') {
                $this->scopeToRun($value);
                continue;
            }
            $this->model->where($key, $value);
        }
        $count = $this->model->countAllResults(false);
        $this->model->delete();

        Services::auditService()->log('error_register_clear', [
            'subject_kind' => 'error_register',
            'metadata'     => ['scope' => $scope, 'deleted' => $count],
        ]);

        return $this->respond(['ok' => true, 'data' => ['deleted' => $count, 'scope' => $scope]]);
    }

    private function roleAllowed(array $roles): bool
    {
        $user = $this->request->qaUser ?? null;

        return $user && (bool) array_intersect($roles, (array) ($user['roles'] ?? []));
    }
}
