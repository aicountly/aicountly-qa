<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\CredentialsModel;
use App\Models\RunsModel;
use App\Models\SessionsModel;
use App\Models\TargetProfilesModel;
use Config\Environments;
use Config\Services;

class TargetProfilesController extends BaseResourceApiController
{
    protected $modelName = TargetProfilesModel::class;
    protected $format    = 'json';

    /** Lifecycle states a profile may hold; `archived` is hidden from pickers. */
    private const STATUSES = ['active', 'paused', 'disabled', 'archived'];

    /** How the worker signs in. `jump_to` picks the product from the identity dropdown first. */
    private const LOGIN_STRATEGIES = ['standard', 'jump_to', 'sso'];

    /** How much a session is allowed to do once it is signed in. */
    private const EXECUTION_MODES = ['full', 'readonly', 'smoke'];

    /**
     * Archived profiles stay in the database for audit but never appear in a
     * picker. `?status=archived` (or `?include_archived=1`) opts back in.
     */
    public function index()
    {
        $status          = trim((string) $this->request->getGet('status'));
        $includeArchived = filter_var(
            (string) $this->request->getGet('include_archived'),
            FILTER_VALIDATE_BOOLEAN
        );

        $builder = $this->model->orderBy('product_name')->orderBy('profile_name');
        if ($status !== '') {
            $builder->where('status', $status);
        } elseif (! $includeArchived) {
            $builder->where('status !=', 'archived');
        }

        $rows = $builder->findAll();
        $ids  = array_map(static fn ($r) => (int) $r['id'], $rows);
        $withCreds = [];
        if ($ids !== []) {
            $credRows = $this->model->db->table('qa_credentials')
                ->select('target_profile_id')
                ->whereIn('target_profile_id', $ids)
                ->get()->getResultArray();
            foreach ($credRows as $c) {
                $withCreds[(int) $c['target_profile_id']] = true;
            }
        }
        foreach ($rows as $i => $row) {
            $rows[$i]['has_credentials'] = isset($withCreds[(int) $row['id']]);
        }
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
        $valid = $this->validateInput($body, strict: true);
        if ($valid !== true) {
            return $this->failValidationErrors($valid);
        }

        $u = $this->request->qaUser;
        $row = $this->prepRow($body);
        $row['created_by'] = $u['id'];
        $row['updated_by'] = $u['id'];

        $id = $this->model->insert($row);
        if (trim((string) ($body['password'] ?? '')) !== '') {
            $this->storePassword((int) $id, (string) $body['password']);
        }
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
        $valid = $this->validateInput($body, strict: false);
        if ($valid !== true) {
            return $this->failValidationErrors($valid);
        }
        $patch = $this->prepRow($body, partial: true, existing: $row);
        $patch['updated_by'] = $this->request->qaUser['id'];
        $this->model->update($id, $patch);

        if (array_key_exists('password', $body) && trim((string) $body['password']) !== '') {
            $this->storePassword((int) $id, (string) $body['password']);
        }

        Services::auditService()->log('target_profile_update', ['subject_kind' => 'target_profile', 'subject_id' => $id]);

        return $this->respond(['ok' => true, 'data' => $this->model->find($id)]);
    }

    /**
     * Owner-only cascade: a profile owns its QA runs, so deleting it wipes each
     * run's on-disk evidence first, then lets the FK cascade clear the rows.
     */
    public function delete($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden('Only an Owner can delete a target app profile.');
        }
        $profile = $this->model->find($id);
        if (! $profile) {
            return $this->failNotFound();
        }

        $runs = (new RunsModel())->where('target_profile_id', (int) $id)->findAll();
        $active = 0;
        foreach ($runs as $run) {
            $active += (new SessionsModel())
                ->where('qa_run_id', $run['qa_run_id'])
                ->whereIn('status', SessionsModel::LEASED)
                ->countAllResults();
        }
        if ($active > 0) {
            return $this->fail(
                'Cannot delete this profile while ' . $active . ' session(s) are still executing. '
                . 'Cancel the running QA run first.',
                409
            );
        }

        $removed = 0;
        foreach ($runs as $run) {
            if (Services::reportService()->deleteRunArtifacts(
                (string) $run['qa_run_id'],
                isset($run['product_name']) ? (string) $run['product_name'] : null
            )) {
                $removed++;
            }
        }

        $db = $this->model->db;
        $db->transStart();
        (new RunsModel())->where('target_profile_id', (int) $id)->delete();
        $db->table('qa_credentials')->where('target_profile_id', (int) $id)->delete();
        $this->model->delete($id);
        $db->transComplete();

        if (! $db->transStatus()) {
            return $this->fail('Failed to delete the target app profile and its QA runs.', 500);
        }

        Services::auditService()->log('target_profile_delete', [
            'subject_kind' => 'target_profile',
            'subject_id'   => $id,
            'metadata'     => ['runs_deleted' => count($runs), 'run_directories_removed' => $removed],
        ]);

        return $this->respondDeleted([
            'ok'   => true,
            'data' => ['runs_deleted' => count($runs), 'run_directories_removed' => $removed],
        ]);
    }

    /** Inline password on create/update, stored in the same encrypted table as the credentials endpoint. */
    private function storePassword(int $profileId, string $password): void
    {
        $enc = Services::vault()->encrypt($password);
        (new CredentialsModel())->upsertForProfile(
            $profileId,
            $enc,
            isset($this->request->qaUser['id']) ? (int) $this->request->qaUser['id'] : null
        );
        Services::auditService()->log('target_app_login_credentials_set', [
            'subject_kind' => 'target_profile',
            'subject_id'   => $profileId,
            'metadata'     => ['via' => 'target_profile_inline'],
        ]);
    }

    /**
     * Mirrors smoke's validateProfileInput: required fields on create, and on
     * both verbs a known product, a known environment tier, real URLs and a
     * status from the allowed set.
     *
     * @param array<string, mixed> $body
     */
    private function validateInput(array $body, bool $strict): true|array
    {
        $errors = [];

        if ($strict) {
            foreach (['profile_name', 'product_name', 'environment', 'base_url', 'login_url', 'username'] as $f) {
                if (empty($body[$f])) {
                    $errors[$f] = "{$f} is required";
                }
            }
        }

        if (! empty($body['product_name'])) {
            $catalog = (array) (config('Products')->catalog ?? []);
            if ($catalog !== [] && ! in_array((string) $body['product_name'], $catalog, true)) {
                $errors['product_name'] = 'must be one of: ' . implode(', ', $catalog);
            }
        }

        if (! empty($body['environment'])) {
            $env = Environments::normalize((string) $body['environment']);
            if (! Environments::isKnown($env)) {
                $errors['environment'] = 'must be one of: ' . implode(', ', Environments::ALL);
            }
        }

        foreach (['base_url', 'login_url'] as $f) {
            if (! empty($body[$f]) && ! filter_var((string) $body[$f], FILTER_VALIDATE_URL)) {
                $errors[$f] = "{$f} must be a valid URL";
            }
        }

        if (! empty($body['status']) && ! in_array((string) $body['status'], self::STATUSES, true)) {
            $errors['status'] = 'must be one of: ' . implode(', ', self::STATUSES);
        }

        if (! empty($body['login_strategy']) && ! in_array((string) $body['login_strategy'], self::LOGIN_STRATEGIES, true)) {
            $errors['login_strategy'] = 'must be one of: ' . implode(', ', self::LOGIN_STRATEGIES);
        }

        if (! empty($body['execution_mode']) && ! in_array((string) $body['execution_mode'], self::EXECUTION_MODES, true)) {
            $errors['execution_mode'] = 'must be one of: ' . implode(', ', self::EXECUTION_MODES);
        }

        // Free-form per-target overrides, but it has to be an object so the worker
        // can read it by key rather than guessing at a list or a scalar.
        if (array_key_exists('extra_config', $body) && $body['extra_config'] !== null) {
            $extra = $body['extra_config'];
            if (! is_array($extra) || ($extra !== [] && array_is_list($extra))) {
                $errors['extra_config'] = 'must be a JSON object or null';
            }
        }

        foreach (['allowed_domains', 'allowed_modules', 'ip_restriction'] as $f) {
            if (array_key_exists($f, $body) && ! is_array($body[$f]) && ! is_string($body[$f])) {
                $errors[$f] = 'must be an array of strings';
            }
        }

        return $errors === [] ? true : $errors;
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, mixed>
     */
    private function prepRow(array $body, bool $partial = false, ?array $existing = null): array
    {
        $row = [];
        $copy = [
            'profile_name', 'product_name', 'environment', 'base_url', 'login_url',
            'username', 'execution_mode', 'status', 'login_strategy', 'jump_to',
        ];
        foreach ($copy as $f) {
            if (isset($body[$f])) {
                $row[$f] = $body[$f];
            }
        }
        if (isset($row['environment'])) {
            $row['environment'] = Environments::normalize((string) $row['environment']);
        }
        foreach (['allowed_domains', 'allowed_modules', 'ip_restriction'] as $f) {
            if (isset($body[$f])) {
                $row[$f] = $this->normalizeJsonArray($body[$f]);
            }
        }
        if (array_key_exists('extra_config', $body)) {
            $row['extra_config'] = is_array($body['extra_config']) ? $body['extra_config'] : null;
        }
        foreach (['data_creation_allowed', 'production_restriction', 'observer_mode', 'read_only', 'allow_safe_demo'] as $f) {
            if (array_key_exists($f, $body)) {
                $row[$f] = (bool) $body[$f];
            }
        }

        if (! $partial) {
            $row['data_creation_allowed']  = $row['data_creation_allowed']  ?? true;
            $row['production_restriction'] = $row['production_restriction'] ?? true;
            $row['execution_mode']         = $row['execution_mode'] ?? 'full';
            $row['status']                 = $row['status'] ?? 'active';
            $row['login_strategy']         = $row['login_strategy'] ?? 'standard';
            $row['observer_mode']          = $row['observer_mode'] ?? false;
            $row['read_only']              = $row['read_only'] ?? false;
            $row['allow_safe_demo']        = $row['allow_safe_demo'] ?? true;
        }

        $env = (string) ($row['environment'] ?? $existing['environment'] ?? Environments::DEFAULT);

        return $this->applyEnvironmentPolicy($row, $env);
    }

    /**
     * Observer-only tiers can never be talked out of their restrictions, whatever
     * the request body says. Non-observer tiers get their defaults back so a
     * profile moved off production is usable again.
     *
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function applyEnvironmentPolicy(array $row, string $environment): array
    {
        if (Environments::isObserverOnly($environment)) {
            $row['observer_mode']          = true;
            $row['read_only']              = true;
            $row['production_restriction'] = true;
            $row['allow_safe_demo']        = false;
            $row['data_creation_allowed']  = false;

            return $row;
        }

        if (! Environments::allowsDataCreation($environment)) {
            $row['data_creation_allowed'] = false;
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
