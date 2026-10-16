<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\UsersModel;
use Config\Services;

/**
 * Local QA user listing and deactivation. Roles are NOT editable here: Console
 * assigns them (Console -> Roles & Access) and they are synced at sign-in,
 * token refresh and the periodic re-check (see ConsoleRoleSyncService).
 */
class UsersController extends BaseResourceApiController
{
    public const ROLES_READ_ONLY_MESSAGE = 'Roles are assigned in Console → Roles & Access (https://console.aicountly.org).';
    private const LIST_COLUMNS = 'id, email, name, status, last_login_at, created_at, console_user_id, roles_synced_at';

    protected $modelName = UsersModel::class;
    protected $format    = 'json';

    public function index()
    {
        $rows = $this->model->select(self::LIST_COLUMNS)->findAll();
        foreach ($rows as &$r) {
            $r['roles'] = $this->model->roleCodes((int) $r['id']);
        }
        return $this->respond(['ok' => true, 'data' => $rows, 'roles_managed_by' => 'console', 'roles_note' => self::ROLES_READ_ONLY_MESSAGE]);
    }

    public function show($id = null)
    {
        $row = $this->model->select(self::LIST_COLUMNS)->find($id);
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
        if (array_key_exists('roles', $body)) {
            return $this->failForbidden(self::ROLES_READ_ONLY_MESSAGE);
        }
        if (empty($body['email']) || empty($body['password']) || empty($body['name'])) {
            return $this->failValidationErrors(['email', 'name', 'password', 'required']);
        }

        $id = $this->model->insert([
            'email'         => trim($body['email']),
            'name'          => trim($body['name']),
            'password_hash' => password_hash($body['password'], PASSWORD_BCRYPT),
            'status'        => 'active',
        ]);

        Services::auditService()->log('user_create', ['subject_kind' => 'user', 'subject_id' => $id]);
        return $this->respondCreated(['ok' => true, 'data' => ['id' => $id]]);
    }

    public function update($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden();
        }
        $body = $this->request->getJSON(true) ?: [];
        if (array_key_exists('roles', $body)) {
            return $this->failForbidden(self::ROLES_READ_ONLY_MESSAGE);
        }
        $patch = array_intersect_key($body, array_flip(['email', 'name', 'status']));
        if (! empty($body['password'])) {
            $patch['password_hash'] = password_hash($body['password'], PASSWORD_BCRYPT);
        }
        $this->model->update($id, $patch);
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

    private function roleAllowed(array $roles): bool
    {
        $u = $this->request->qaUser ?? null;
        return $u && (bool) array_intersect($roles, (array) ($u['roles'] ?? []));
    }
}
