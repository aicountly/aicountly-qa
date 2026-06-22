<?php

namespace App\Controllers\Api\V1;

use App\Models\RunsModel;
use App\Models\SessionPlansModel;
use App\Models\SessionsModel;
use CodeIgniter\RESTful\ResourceController;
use Config\Services;

class SessionPlansController extends ResourceController
{
    protected $modelName = SessionPlansModel::class;
    protected $format    = 'json';

    public function index()
    {
        $runId = $this->request->getGet('qa_run_id');
        if ($runId) {
            $this->model->where('qa_run_id', $runId);
        }
        return $this->respond(['ok' => true, 'data' => $this->model->orderBy('id', 'DESC')->findAll()]);
    }

    public function show($id = null)
    {
        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        return $this->respond(['ok' => true, 'data' => $row]);
    }

    public function generate()
    {
        $body = $this->request->getJSON(true) ?: [];
        $qaRunId   = (string) ($body['qa_run_id'] ?? '');
        $profileId = (int) ($body['target_profile_id'] ?? 0);
        $prompt    = (string) ($body['prompt_text'] ?? '');
        $kind      = (string) ($body['prompt_kind'] ?? 'template');

        if ($qaRunId === '' || $profileId <= 0 || $prompt === '') {
            return $this->failValidationErrors('qa_run_id, target_profile_id and prompt_text required.');
        }

        $plan = Services::sessionPlanner()->generateDraft($qaRunId, $profileId, $prompt, $kind);
        return $this->respond(['ok' => true, 'data' => $plan]);
    }

    public function update($id = null)
    {
        $body = $this->request->getJSON(true) ?: [];
        if (! isset($body['plan_json'])) {
            return $this->failValidationErrors('plan_json required.');
        }
        $this->model->update($id, ['plan_json' => $body['plan_json']]);
        Services::auditService()->log('session_plan_update', ['subject_kind' => 'session_plan', 'subject_id' => $id]);
        return $this->respond(['ok' => true]);
    }

    public function approve($id = null)
    {
        $plan = $this->model->find($id);
        if (! $plan) {
            return $this->failNotFound();
        }
        $u = $this->request->qaUser;
        $this->model->update($id, [
            'status'      => 'approved',
            'approved_by' => $u['id'],
            'approved_at' => date('Y-m-d H:i:s'),
        ]);

        // Materialise sessions from plan_json into qa_sessions queue.
        $sessions = new SessionsModel();
        $planJson = is_string($plan['plan_json']) ? json_decode($plan['plan_json'], true) : $plan['plan_json'];
        $entries  = (array) ($planJson['sessions'] ?? []);

        foreach ($entries as $i => $entry) {
            $sessions->insert([
                'qa_run_id'       => $plan['qa_run_id'],
                'session_plan_id' => (int) $id,
                'name'            => (string) ($entry['name'] ?? ('Session ' . ($i + 1))),
                'template_code'   => (string) ($entry['template_code'] ?? ''),
                'module'          => $entry['module']     ?? null,
                'sub_module'      => $entry['sub_module'] ?? null,
                'order_index'     => (int) ($entry['order_index'] ?? ($i + 1)),
                'scope_json'      => $entry['scope'] ?? [],
                'status'          => 'queued',
            ]);
        }

        if (count($entries) > 0) {
            (new RunsModel())->update($plan['qa_run_id'], ['status' => 'running']);
        }

        Services::auditService()->log('session_approval', [
            'qa_run_id'    => $plan['qa_run_id'],
            'subject_kind' => 'session_plan',
            'subject_id'   => $id,
            'metadata'     => ['count' => count($entries)],
        ]);

        return $this->respond(['ok' => true, 'data' => ['queued' => count($entries)]]);
    }
}
