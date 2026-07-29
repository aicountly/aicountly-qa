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
        (new SessionsModel())->recoverStaleSessions();
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
        (new SessionsModel())->recoverStaleSessions();
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
            $failedSteps = [];
            if (! empty($rj['failed_steps']) && is_array($rj['failed_steps'])) {
                foreach ($rj['failed_steps'] as $step) {
                    if (is_array($step)) {
                        $failedSteps[] = (string) ($step['kind'] ?? $step['step'] ?? $step['error'] ?? 'step');
                        if ($fatal === null && ! empty($step['error'])) {
                            $fatal = (string) $step['error'];
                        }
                    } elseif (is_string($step)) {
                        $failedSteps[] = $step;
                    }
                }
            }

            $module = strtolower((string) ($s['module'] ?? ''));
            $isLoginSession = $module === 'login' || str_contains(strtolower((string) ($s['template_code'] ?? '')), 'login');

            // Login early-exit: ignore noisy accounting rule dumps and show the real blocker.
            if ($isLoginSession && ($failedSteps !== [] || ($res['status'] ?? '') === 'partial')) {
                $stepList = $failedSteps !== [] ? implode(', ', array_unique($failedSteps)) : 'login workflow';
                $fatal = 'Login did not complete. Failed steps: ' . $stepList
                    . '. Check Target App Profile login URL, username, saved password, Jump To selection, and any OTP/challenge. Selectors must match the two-step Smart Books login form.';
            } elseif ($fatal === null && ($res['status'] ?? '') === 'partial' && (int) ($rj['workflow_steps'] ?? 0) <= 1) {
                $fatal = 'Session failed early (often missing target credentials or login error).';
            }

            $suggestedArea   = $res['suggested_area'] ?? null;
            $suggestedPrompt = $res['suggested_prompt'] ?? null;
            if ($isLoginSession && $fatal !== null) {
                // Hide misleading "all product rules failed" guidance for login sessions.
                $suggestedArea   = 'Login credentials / Jump To / OTP challenge';
                $suggestedPrompt = 'Verify Book Login profile and the two-step flow: fill identity, select Smart Books in Jump To (#jumptoe), submit, wait for password, then continue. Check saved password and complete or report any OTP/2FA challenge.';
            }

            $sessions[$i]['result_summary'] = [
                'status'           => $res['status'] ?? null,
                'severity'         => $res['severity'] ?? null,
                'passed_count'     => (int) ($res['passed_count'] ?? 0),
                'failed_count'     => (int) ($res['failed_count'] ?? 0),
                'suggested_area'   => $suggestedArea,
                'suggested_prompt' => $suggestedPrompt,
                'fatal_error'      => $fatal,
                'failed_steps'     => $failedSteps,
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
            ->whereIn('status', SessionsModel::LEASED)
            ->countAllResults();
        if ($active > 0) {
            return $this->fail('Cannot delete a run while sessions are executing.', 409);
        }

        // Wipe screenshots, session reports, and logs on disk before DB cascade.
        $removed = Services::reportService()->deleteRunArtifacts(
            (string) $id,
            isset($row['product_name']) ? (string) $row['product_name'] : null
        );

        $this->model->delete($id);
        Services::auditService()->log('qa_run_delete', [
            'qa_run_id'    => $id,
            'subject_kind' => 'qa_run',
            'subject_id'   => $id,
            'metadata'     => ['disk_artifacts_removed' => $removed],
        ]);

        return $this->respondDeleted(['ok' => true, 'disk_artifacts_removed' => $removed]);
    }

    public function update($id = null)
    {
        $body = $this->request->getJSON(true);
        $body = is_array($body) ? $body : [];
        if (($body['status'] ?? null) !== 'cancelled') {
            return parent::update($id);
        }
        $run = $this->model->find($id);
        if (! $run) {
            return $this->failNotFound();
        }

        $now = date('Y-m-d H:i:s');
        $db = $this->model->db;
        $db->transStart();
        $db->table('qa_run_decisions')
            ->where('qa_run_id', $id)
            ->where('status', 'pending')
            ->update(['status' => 'cancelled', 'updated_at' => $now]);
        $db->table('qa_sessions')
            ->where('qa_run_id', $id)
            ->whereIn('status', SessionsModel::ACTIVE)
            ->update(['status' => 'cancelled', 'completed_at' => $now, 'updated_at' => $now]);
        $this->model->update($id, ['status' => 'cancelled', 'completed_at' => $now]);
        $db->transComplete();
        if (! $db->transStatus()) {
            return $this->fail('Failed to cancel QA run.', 500);
        }
        Services::auditService()->log('qa_run_cancel', ['qa_run_id' => $id]);

        return $this->respond(['ok' => true, 'data' => $this->model->find($id)]);
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
                 AND s.status IN ('queued', 'claimed', 'running', 'awaiting_decision')
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
