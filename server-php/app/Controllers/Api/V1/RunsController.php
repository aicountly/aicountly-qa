<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseResourceApiController;
use App\Models\ErrorRegisterModel;
use App\Models\FileIoTestsModel;
use App\Models\ReportsModel;
use App\Models\RunDecisionsModel;
use App\Models\RunsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\TargetProfilesModel;
use Config\Services;

class RunsController extends BaseResourceApiController
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

        return $this->cancel($id);
    }

    /**
     * Cancel every queued/active session and pending decision, then mark the run
     * cancelled. Each cancelled session gets an Error Register entry so the run
     * does not silently disappear from triage.
     */
    public function cancel($id = null)
    {
        if (! $this->roleAllowed(['Owner', 'QA Manager'])) {
            return $this->failForbidden('Only an Owner or QA Manager can cancel a QA run.');
        }

        $run = $this->model->find($id);
        if (! $run) {
            return $this->failNotFound();
        }
        if (in_array((string) ($run['status'] ?? ''), ['cancelled', 'completed', 'failed'], true)) {
            return $this->respond(['ok' => true, 'data' => $run, 'note' => 'Run was already finished.']);
        }

        $sessions = (new SessionsModel())
            ->where('qa_run_id', $id)
            ->whereIn('status', SessionsModel::ACTIVE)
            ->findAll();
        $decisions = (new RunDecisionsModel())
            ->where('qa_run_id', $id)
            ->where('status', 'pending')
            ->findAll();

        $now = date('Y-m-d H:i:s');
        $db  = $this->model->db;
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

        $this->registerCancellation((string) $id, $run, $sessions, $decisions);

        Services::auditService()->log('qa_run_cancel', [
            'qa_run_id' => $id,
            'metadata'  => [
                'sessions_cancelled'  => count($sessions),
                'decisions_cancelled' => count($decisions),
            ],
        ]);

        return $this->respond([
            'ok'   => true,
            'data' => [
                'run'                 => $this->model->find($id),
                'sessions_cancelled'  => count($sessions),
                'decisions_cancelled' => count($decisions),
            ],
        ]);
    }

    /** Everything the QA run was still owed becomes a visible, triage-able error. */
    private function registerCancellation(string $qaRunId, array $run, array $sessions, array $decisions): void
    {
        if ($sessions === [] && $decisions === []) {
            return;
        }

        $names = array_slice(array_map(
            static fn (array $s): string => (string) ($s['name'] ?? $s['template_code'] ?? ('session ' . $s['id'])),
            $sessions
        ), 0, 8);

        $summary = 'QA run ' . $qaRunId . ' was cancelled with ' . count($sessions)
            . ' session(s) unfinished and ' . count($decisions) . ' operator decision(s) still pending'
            . ($names !== [] ? ': ' . implode(', ', $names) . '.' : '.');

        (new ErrorRegisterModel())->upsertSignature([
            'signature'                => sha1('run-cancelled|' . $qaRunId),
            'title'                    => 'QA run cancelled before completion',
            'severity'                 => 'medium',
            'product_name'             => $run['product_name'] ?? null,
            'module'                   => 'worker',
            'last_seen_run_id'         => $qaRunId,
            'last_session_id'          => isset($sessions[0]['id']) ? (int) $sessions[0]['id'] : null,
            'sample_message'           => $summary,
            'human_summary'            => $summary,
            'developer_fix_prompt'     => 'QA run ' . $qaRunId . ' was cancelled mid-flight. Review why the remaining '
                . 'sessions could not finish (blocked decisions, worker stall, or an unrecoverable target error), '
                . 'then make that path either self-recovering or fail fast with a clear error.',
            'suggested_developer_area' => 'QA run lifecycle / worker session recovery',
        ]);

        foreach ($decisions as $decision) {
            (new ErrorRegisterModel())->upsertSignature([
                'signature'                => sha1('decision-cancelled|' . $qaRunId . '|' . ($decision['situation_key'] ?? '')),
                'title'                    => 'Decision cancelled by run cancellation: ' . ($decision['situation_key'] ?? ''),
                'severity'                 => 'medium',
                'product_name'             => $run['product_name'] ?? null,
                'module'                   => 'worker',
                'last_seen_run_id'         => $qaRunId,
                'last_session_id'          => isset($decision['session_id']) ? (int) $decision['session_id'] : null,
                'sample_message'           => (string) ($decision['question'] ?? ''),
                'human_summary'            => 'The worker was blocked waiting on "' . ($decision['situation_key'] ?? '')
                    . '" when the run was cancelled, so that path was never verified.',
                'developer_fix_prompt'     => 'Make situation "' . ($decision['situation_key'] ?? '')
                    . '" resolvable without an operator, or document the deterministic answer so QA can continue unattended.',
                'suggested_developer_area' => 'QA worker decision handling',
            ]);
        }
    }

    /** File I/O verdicts for a run, shaped for the portal table. */
    public function fileIo($id = null)
    {
        if (! $this->model->find($id)) {
            return $this->failNotFound();
        }

        $rows = (new FileIoTestsModel())->forRun((string) $id);
        $data = array_map(static function (array $row): array {
            $paths = is_array($row['artifact_paths_json'] ?? null) ? $row['artifact_paths_json'] : [];

            return [
                'id'                 => (int) $row['id'],
                'session_id'         => (int) $row['session_id'],
                'scenario_key'       => $row['scenario_key'],
                'direction'          => $row['direction'],
                'fixture_name'       => $row['fixture_name'],
                'compare_status'     => $row['compare_status'],
                'upload_ok'          => (bool) $row['upload_ok'],
                'download_ok'        => (bool) $row['download_ok'],
                'source_sha256'      => $row['source_sha256'],
                'result_sha256'      => $row['result_sha256'],
                'source_mime'        => $row['source_mime'],
                'result_mime'        => $row['result_mime'],
                'source_bytes'       => $row['source_bytes'] !== null ? (int) $row['source_bytes'] : null,
                'result_bytes'       => $row['result_bytes'] !== null ? (int) $row['result_bytes'] : null,
                'structure_ok'       => (bool) $row['structure_ok'],
                'structure_notes'    => $row['structure_notes'],
                'rows_expected'      => $row['rows_expected'] !== null ? (int) $row['rows_expected'] : null,
                'rows_found'         => $row['rows_found'] !== null ? (int) $row['rows_found'] : null,
                'mismatched_cells'   => $row['mismatched_cells'] !== null ? (int) $row['mismatched_cells'] : null,
                'mismatches'         => $row['mismatches_json'] ?? [],
                'totals_expected'    => $row['totals_expected'] ?? [],
                'totals_found'       => $row['totals_found'] ?? [],
                'data_verified'      => $row['data_verified'],
                'verification_notes' => $row['verification_notes'],
                'artifact_keys'      => array_keys($paths),
                'created_at'         => $row['created_at'] ?? null,
            ];
        }, $rows);

        return $this->respond([
            'ok'      => true,
            'data'    => $data,
            'summary' => FileIoTestsModel::summarise($rows),
        ]);
    }

    /** Stream one stored artifact (fixture or downloaded export) for a file I/O test. */
    public function fileIoArtifact($id = null, $testId = null, $key = null)
    {
        $row = (new FileIoTestsModel())->find((int) $testId);
        if (! $row || (string) $row['qa_run_id'] !== (string) $id) {
            return $this->failNotFound('File I/O test not found for this run.');
        }

        $paths = is_array($row['artifact_paths_json'] ?? null) ? $row['artifact_paths_json'] : [];
        $path  = $paths[(string) $key] ?? null;
        if (! $path || ! is_file($path)) {
            return $this->failNotFound('Artifact "' . $key . '" is not available on the API host.');
        }

        // Only serve from inside the reports root — artifact paths come from the worker.
        $root = Services::reportService()->reportsRoot();
        $real = realpath($path);
        if ($real === false || ! str_starts_with($real, $root)) {
            return $this->failForbidden('Artifact path is outside the reports directory.');
        }

        $name = basename($real);
        // The fixture is what we uploaded, so it carries the source mime; every other
        // key is something the product handed back.
        $mime = (string) $key === 'fixture'
            ? (string) ($row['source_mime'] ?? '')
            : (string) ($row['result_mime'] ?? '');
        $mime = $mime !== '' ? $mime : 'application/octet-stream';

        return $this->response
            ->setHeader('Content-Type', $mime)
            ->setHeader('Content-Disposition', 'attachment; filename="' . $name . '"')
            ->setBody((string) file_get_contents($real));
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
