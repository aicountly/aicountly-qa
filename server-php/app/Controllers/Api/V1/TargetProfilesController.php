<?php

namespace App\Controllers\Api\V1;

use App\Models\TargetProfilesModel;
use CodeIgniter\RESTful\ResourceController;
use Config\Services;

class TargetProfilesController extends ResourceController
{
    protected $modelName = TargetProfilesModel::class;
    protected $format    = 'json';

    public function index()
    {
        $rows = $this->model->orderBy('product_name')->orderBy('profile_name')->findAll();
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    public function show($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $row['has_credentials'] = (bool) $this->model->db->table('qa_credentials')->where('target_profile_id', $id)->countAllResults();
        return $this->respond(['ok' => true, 'data' => $row]);
    }

    public function create()
    {
        if (! $this->roleAllowed(['Owner', 'QA Manager'])) {
            return $this->failForbidden();
        }
        $body = $this->request->getJSON(true) ?: [];
        $valid = $this->validateInput($body);
        if ($valid !== true) {
            return $this->failValidationErrors($valid);
        }

        $u = $this->request->qaUser;
        $row = $this->prepRow($body);
        $row['created_by'] = $u['id'];
        $row['updated_by'] = $u['id'];

        $id = $this->model->insert($row);
        Services::auditService()->log('target_profile_create', [
            'subject_kind' => 'target_profile',
            'subject_id'   => $id,
            'metadata'     => ['environment' => $row['environment'] ?? null, 'product_name' => $row['product_name'] ?? null],
        ]);
        return $this->respondCreated(['ok' => true, 'data' => ['id' => $id]]);
    }

    public function update($id = null)
    {
        if (! $this->roleAllowed(['Owner', 'QA Manager'])) {
            return $this->failForbidden();
        }
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $body = $this->request->getJSON(true) ?: [];
        $patch = $this->prepRow($body, partial: true);
        $patch['updated_by'] = $this->request->qaUser['id'];
        $this->model->update($id, $patch);
        Services::auditService()->log('target_profile_update', ['subject_kind' => 'target_profile', 'subject_id' => $id]);
        return $this->respond(['ok' => true]);
    }

    public function delete($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden();
        }
        $this->model->delete($id);
        Services::auditService()->log('target_profile_delete', ['subject_kind' => 'target_profile', 'subject_id' => $id]);
        return $this->respondDeleted(['ok' => true]);
    }

    private function validateInput(array $body): true|array
    {
        $errors = [];
        foreach (['profile_name', 'product_name', 'environment', 'base_url', 'login_url', 'username'] as $f) {
            if (empty($body[$f])) {
                $errors[$f] = "{$f} is required";
            }
        }
        if (! empty($body['environment']) && ! in_array($body['environment'], ['sandbox', 'gh', 'prod_basic', 'prod_full'], true)) {
            $errors['environment'] = 'must be one of: sandbox, gh, prod_basic, prod_full';
        }
        return $errors === [] ? true : $errors;
    }

    private function prepRow(array $body, bool $partial = false): array
    {
        $row = [];
        $copy = ['profile_name', 'product_name', 'environment', 'base_url', 'login_url', 'username', 'execution_mode', 'status'];
        foreach ($copy as $f) {
            if (isset($body[$f])) {
                $row[$f] = $body[$f];
            }
        }
        foreach (['allowed_domains', 'allowed_modules', 'ip_restriction'] as $f) {
            if (isset($body[$f])) {
                $row[$f] = $this->normalizeJsonArray($body[$f]);
            }
        }
        foreach (['data_creation_allowed', 'production_restriction'] as $f) {
            if (array_key_exists($f, $body)) {
                $row[$f] = (bool) $body[$f];
            }
        }
        if (! $partial) {
            $row['data_creation_allowed']  = $row['data_creation_allowed']  ?? true;
            $row['production_restriction'] = $row['production_restriction'] ?? true;
            $row['execution_mode']         = $row['execution_mode'] ?? 'full';
            $row['status']                 = $row['status'] ?? 'active';
        }
        return $row;
    }

    private function normalizeJsonArray(mixed $value): array
    {
        if (is_array($value)) {
            return $value;
        }
        if (is_string($value) && $value !== '') {
            $decoded = json_decode($value, true);

            return is_array($decoded) ? $decoded : [];
        }

        return [];
    }

    private function roleAllowed(array $roles): bool
    {
        $u = $this->request->qaUser ?? null;
        return $u && (bool) array_intersect($roles, (array) ($u['roles'] ?? []));
    }
}
