<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\CredentialsModel;
use App\Models\RunsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\TargetProfilesModel;
use App\Models\TestDataPacksModel;
use App\Models\ExpectedResultsModel;
use App\Models\ValidationResultsModel;
use App\Models\ValidationRulesModel;
use App\Models\ErrorRegisterModel;
use Config\Services;

/**
 * Endpoints used only by the Playwright worker (auth via X-Worker-Token).
 * The worker never speaks user-JWT.
 */
class WorkerController extends BaseApiController
{
    public function nextSession()
    {
        $workerId = (string) ($this->request->getGet('worker_id') ?? gethostname());
        $session  = (new SessionsModel())->claimNext($workerId);

        if (! $session) {
            return $this->ok(['session' => null]);
        }

        // Bundle context the worker needs to run the session.
        $run     = (new RunsModel())->find($session['qa_run_id']);
        $profile = (new TargetProfilesModel())->find($run['target_profile_id']);

        $packs   = (new TestDataPacksModel())->activeForProduct($profile['product_name']);
        $pack    = $packs[0] ?? null;
        $expected = $pack ? (new ExpectedResultsModel())->forPack((int) $pack['id']) : [];

        $rules = (new ValidationRulesModel())->activeForProduct($profile['product_name']);

        $template = $this->loadTemplate($profile['product_name'], (string) $session['template_code']);

        // Mark session running.
        (new SessionsModel())->update($session['id'], ['status' => 'running', 'started_at' => date('Y-m-d H:i:s')]);

        Services::auditService()->log('session_execution_start', [
            'qa_run_id'  => $session['qa_run_id'],
            'session_id' => $session['id'],
            'metadata'   => ['template' => $session['template_code']],
        ]);

        return $this->ok([
            'session'   => $session,
            'run'       => $run,
            'profile'   => $profile,
            'template'  => $template,
            'pack'      => $pack,
            'expected'  => $expected,
            'rules'     => $rules,
        ]);
    }

    public function claim(int $sessionId)
    {
        $workerId = (string) ($this->request->getGet('worker_id') ?? gethostname());
        $now = date('Y-m-d H:i:s');
        (new SessionsModel())->update($sessionId, [
            'status' => 'claimed',
            'claimed_by_worker' => $workerId,
            'claimed_at' => $now,
            'last_heartbeat_at' => $now,
        ]);
        return $this->ok(['claimed' => true]);
    }

    public function heartbeat(int $sessionId)
    {
        (new SessionsModel())->update($sessionId, ['last_heartbeat_at' => date('Y-m-d H:i:s')]);
        return $this->ok(['ok' => true]);
    }

    public function credentials(int $targetProfileId)
    {
        $row = (new CredentialsModel())->findByProfile($targetProfileId);
        if (! $row) {
            return $this->fail('Credentials not configured for this target.', 404);
        }
        // Decrypt in-memory and return plaintext to the worker (TLS-protected).
        $plaintext = Services::vault()->decrypt(
            $row['iv'],
            $row['secret_ciphertext'],
            $row['auth_tag']
        );
        Services::auditService()->log('target_app_login_credentials_fetched', [
            'subject_kind' => 'target_profile',
            'subject_id'   => $targetProfileId,
        ]);
        return $this->ok(['password' => $plaintext, 'version' => (int) $row['version']]);
    }

    public function postResult(int $sessionId)
    {
        $body = $this->input();
        $status   = (string) ($body['status']   ?? 'failed');
        $severity = (string) ($body['severity'] ?? 'low');
        $passed   = (int)    ($body['passed_count']  ?? 0);
        $failed   = (int)    ($body['failed_count']  ?? 0);
        $warning  = (int)    ($body['warning_count'] ?? 0);

        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }

        $results = new SessionResultsModel();
        $results->insert([
            'session_id'       => $sessionId,
            'qa_run_id'        => $session['qa_run_id'],
            'status'           => $status,
            'severity'         => $severity,
            'passed_count'     => $passed,
            'failed_count'     => $failed,
            'warning_count'    => $warning,
            'result_json'      => json_encode($body['result_json'] ?? []),
            'screenshot_paths' => json_encode($body['screenshot_paths'] ?? []),
            'trace_path'       => $body['trace_path'] ?? null,
            'console_errors'   => json_encode($body['console_errors'] ?? []),
            'network_errors'   => json_encode($body['network_errors'] ?? []),
            'suggested_area'   => $body['suggested_area']   ?? null,
            'suggested_prompt' => $body['suggested_prompt'] ?? null,
            'started_at'       => $body['started_at']  ?? null,
            'completed_at'     => $body['completed_at'] ?? date('Y-m-d H:i:s'),
            'created_at'       => date('Y-m-d H:i:s'),
        ]);

        // Save per-rule validation results.
        $validations = $body['validations'] ?? [];
        $vr = new ValidationResultsModel();
        foreach ((array) $validations as $v) {
            $vr->insert([
                'session_id' => $sessionId,
                'qa_run_id'  => $session['qa_run_id'],
                'rule_code'  => (string) ($v['rule_code'] ?? ''),
                'passed'     => (bool) ($v['passed'] ?? false),
                'expected'   => isset($v['expected']) ? (string) $v['expected'] : null,
                'actual'     => isset($v['actual'])   ? (string) $v['actual']   : null,
                'diff'       => isset($v['diff'])     ? (string) $v['diff']     : null,
                'severity'   => (string) ($v['severity'] ?? 'low'),
                'notes'      => isset($v['notes'])    ? (string) $v['notes']    : null,
                'created_at' => date('Y-m-d H:i:s'),
            ]);

            // Roll up to error register on failure.
            if (empty($v['passed'])) {
                (new ErrorRegisterModel())->upsertSignature([
                    'signature'              => sha1(($v['rule_code'] ?? '') . '|' . ($v['expected'] ?? '') . '|' . ($v['actual'] ?? '')),
                    'title'                  => 'Failed: ' . (string) ($v['rule_code'] ?? ''),
                    'severity'               => (string) ($v['severity'] ?? 'medium'),
                    'product_name'           => $body['product_name'] ?? null,
                    'module'                 => $session['module'] ?? null,
                    'last_seen_run_id'       => $session['qa_run_id'],
                    'last_session_id'        => $sessionId,
                    'sample_message'         => (string) ($v['notes'] ?? ''),
                    'suggested_developer_area' => (string) ($body['suggested_area'] ?? ''),
                ]);
            }
        }

        (new SessionsModel())->update($sessionId, [
            'status'       => in_array($status, ['passed', 'failed', 'skipped', 'partial'], true) ? ($status === 'passed' ? 'completed' : $status) : 'completed',
            'completed_at' => date('Y-m-d H:i:s'),
        ]);

        // Generate the session-level report.
        $report = Services::reportService()->buildSessionReport($sessionId);

        Services::auditService()->log('session_execution_complete', [
            'qa_run_id'  => $session['qa_run_id'],
            'session_id' => $sessionId,
            'metadata'   => ['status' => $status, 'severity' => $severity],
        ]);

        // If no queued sessions remain for this run, build the final consolidated report.
        $remaining = (new SessionsModel())->where('qa_run_id', $session['qa_run_id'])
            ->whereIn('status', ['queued', 'claimed', 'running'])->countAllResults();
        if ($remaining === 0) {
            Services::reportService()->buildFinalReport($session['qa_run_id']);
        }

        return $this->ok(['report' => $report]);
    }

    public function uploadEvidence(int $sessionId)
    {
        $file = $this->request->getFile('file');
        $kind = (string) $this->request->getPost('kind');
        if (! $file || ! $file->isValid()) {
            return $this->fail('No file uploaded.', 400);
        }
        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }
        $run = (new RunsModel())->find($session['qa_run_id']);
        $product = $run['product_name'] ?? 'unknown';
        $day = substr($session['qa_run_id'], 7, 8);
        $date = $day ? substr($day, 0, 4) . '-' . substr($day, 4, 2) . '-' . substr($day, 6, 2) : gmdate('Y-m-d');
        $reportsRoot = Services::reportService()->reportsRoot();
        $dir = $reportsRoot . "/{$product}/{$date}/{$session['qa_run_id']}/session-" . str_pad((string) $session['order_index'], 3, '0', STR_PAD_LEFT);
        @mkdir($dir, 0775, true);
        $name = $file->getRandomName();
        $file->move($dir, $name);
        $path = $dir . '/' . $name;

        Services::auditService()->log('screenshot_captured', [
            'qa_run_id'  => $session['qa_run_id'],
            'session_id' => $sessionId,
            'metadata'   => ['kind' => $kind, 'path' => $path],
        ]);

        return $this->ok(['path' => $path]);
    }

    private function loadTemplate(string $product, string $code): ?array
    {
        if ($code === '') {
            return null;
        }
        $file = APPPATH . 'Database/Templates/' . $product . '/' . $code . '.json';
        return is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    }
}
