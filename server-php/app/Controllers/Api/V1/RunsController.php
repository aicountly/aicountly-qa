<?php

namespace App\Controllers\Api\V1;

use App\Models\ReportsModel;
use App\Models\RunsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\TargetProfilesModel;
use CodeIgniter\RESTful\ResourceController;
use Config\Services;

class RunsController extends ResourceController
{
    protected $modelName = RunsModel::class;
    protected $format    = 'json';

    public function index()
    {
        $this->promotePendingRuns();

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
        $this->promotePendingRuns();

        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }
        $sessions = (new SessionsModel())->where('qa_run_id', $id)->orderBy('order_index')->findAll();
        $results  = (new SessionResultsModel())->where('qa_run_id', $id)->findAll();
        $reports  = (new ReportsModel())->where('qa_run_id', $id)->where('kind', 'session')->findAll();

        $resultsBySession = [];
        foreach ($results as $r) {
            $resultsBySession[(int) $r['session_id']] = $r;
        }

        $reportBySession = [];
        foreach ($reports as $rep) {
            if (! empty($rep['session_id'])) {
                $reportBySession[(int) $rep['session_id']] = $rep;
            }
        }

        foreach ($sessions as $i => $s) {
            $sid = (int) $s['id'];
            $res = $resultsBySession[$sid] ?? null;
            if (! $res) {
                $sessions[$i]['result_summary'] = null;
                continue;
            }

            $rj = is_array($res['result_json'] ?? null) ? $res['result_json'] : [];
            $fatal = $rj['fatal_error'] ?? null;
            if ($fatal === null && ! empty($rj['failed_steps']) && is_array($rj['failed_steps'])) {
                $first = $rj['failed_steps'][0] ?? null;
                $fatal = is_array($first) ? ($first['error'] ?? null) : null;
            }
            if ($fatal === null && ($res['status'] ?? '') === 'partial' && (int) ($rj['workflow_steps'] ?? 0) <= 1) {
                $fatal = 'Session failed early (often missing target credentials or login error).';
            }

            $sessions[$i]['result_summary'] = [
                'status'           => $res['status'] ?? null,
                'severity'         => $res['severity'] ?? null,
                'passed_count'     => (int) ($res['passed_count'] ?? 0),
                'failed_count'     => (int) ($res['failed_count'] ?? 0),
                'suggested_area'   => $res['suggested_area'] ?? null,
                'suggested_prompt' => $res['suggested_prompt'] ?? null,
                'fatal_error'      => $fatal,
                'has_report'       => isset($reportBySession[$sid]),
            ];
        }

        $row['sessions'] = $sessions;

        $profileId = (int) ($row['target_profile_id'] ?? 0);
        if ($profileId > 0) {
            $profile = (new TargetProfilesModel())->find($profileId);
            if ($profile) {
                $profile['has_credentials'] = (bool) $this->model->db->table('qa_credentials')
                    ->where('target_profile_id', $profileId)->countAllResults();
                $row['target_profile'] = $profile;
            }
        }

        return $this->respond(['ok' => true, 'data' => $row]);
    }

    public function delete($id = null)
    {
        if (! $this->roleAllowed(['Owner'])) {
            return $this->failForbidden();
        }

        $row = $this->model->find($id);
        if (! $row) {
            return $this->failNotFound();
        }

        $active = (new SessionsModel())
            ->where('qa_run_id', $id)
            ->whereIn('status', ['claimed', 'running'])
            ->countAllResults();
        if ($active > 0) {
            return $this->fail('Cannot delete a run while sessions are executing.', 409);
        }

        $this->model->delete($id);
        Services::auditService()->log('qa_run_delete', [
            'qa_run_id'    => $id,
            'subject_kind' => 'qa_run',
            'subject_id'   => $id,
        ]);

        return $this->respondDeleted(['ok' => true]);
    }

    /** Pending runs with queued sessions should display as running. */
    private function promotePendingRuns(): void
    {
        $this->model->db->query(
            "UPDATE qa_runs r
             SET status = 'running', updated_at = CURRENT_TIMESTAMP
             WHERE r.status = 'pending'
             AND EXISTS (
                 SELECT 1 FROM qa_sessions s
                 WHERE s.qa_run_id = r.qa_run_id
                 AND s.status IN ('queued', 'claimed', 'running')
             )"
        );
    }

    private function roleAllowed(array $roles): bool
    {
        $user = $this->request->qaUser ?? null;
        if (! $user) {
            return false;
        }

        return (bool) array_intersect($roles, (array) ($user['roles'] ?? []));
    }
}
