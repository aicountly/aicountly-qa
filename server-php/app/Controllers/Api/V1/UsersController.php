<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\UserRolesModel;
use App\Models\UsersModel;
use CodeIgniter\RESTful\ResourceController;
use Config\Services;

class UsersController extends ResourceController
{
    protected $modelName = UsersModel::class;
    protected $format    = 'json';

    public function index()
    {
        $rows = $this->model->select('id, email, name, status, last_login_at, created_at')->findAll();
        foreach ($rows as &$r) {
            $r['roles'] = $this->model->roleCodes((int) $r['id']);
        }
        return $this->respond(['ok' => true, 'data' => $rows]);
    }

    public function show($id = null)
    {
        $row = $this->model->select('id, email, name, status, last_login_at, created_at')->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $row['roles'] = $this->model->roleCodes((int) $row['id']);
        return $this->respond(['ok' => true, 'data' => $row]);
    }

    public function create()
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden();
        }
        $body = $this->request->getJSON(true) ?: [];
        if (empty($body['email']) || empty($body['password']) || empty($body['name'])) {
            return $this->failValidationErrors(['email', 'name', 'password', 'required']);
        }

        $id = $this->model->insert([
            'email'         => trim($body['email']),
            'name'          => trim($body['name']),
            'password_hash' => password_hash($body['password'], PASSWORD_BCRYPT),
            'status'        => 'active',
        ]);

        if (! empty($body['roles']) && is_array($body['roles'])) {
            $this->syncRoles((int) $id, $body['roles']);
        }

        Services::auditService()->log('user_create', ['subject_kind' => 'user', 'subject_id' => $id]);
        return $this->respondCreated(['ok' => true, 'data' => ['id' => $id]]);
    }

    public function update($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden();
        }
        $body = $this->request->getJSON(true) ?: [];
        $patch = array_intersect_key($body, array_flip(['email', 'name', 'status']));
        if (! empty($body['password'])) {
            $patch['password_hash'] = password_hash($body['password'], PASSWORD_BCRYPT);
        }
        $this->model->update($id, $patch);
        if (isset($body['roles']) && is_array($body['roles'])) {
            $this->syncRoles((int) $id, $body['roles']);
        }
        Services::auditService()->log('user_update', ['subject_kind' => 'user', 'subject_id' => $id]);
        return $this->respond(['ok' => true]);
    }

    public function delete($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden();
        }
        $this->model->delete($id);
        Services::auditService()->log('user_delete', ['subject_kind' => 'user', 'subject_id' => $id]);
        return $this->respondDeleted(['ok' => true]);
    }

    private function syncRoles(int $userId, array $roleCodes): void
    {
        $db = $this->model->db;
        $roleIds = $db->table('qa_roles')->whereIn('code', $roleCodes)->get()->getResultArray();
        $db->table('qa_user_roles')->where('user_id', $userId)->delete();
        $ur = new UserRolesModel();
        foreach ($roleIds as $r) {
            $ur->insert(['user_id' => $userId, 'role_id' => (int) $r['id'], 'created_at' => date('Y-m-d H:i:s')]);
        }
    }

    private function roleAllowed(array $roles): bool
    {
        $u = $this->request->qaUser ?? null;
        return $u && (bool) array_intersect($roles, (array) ($u['roles'] ?? []));
    }
}
