<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\CredentialsModel;
use App\Models\DecisionMemoryModel;
use App\Models\ErrorRegisterModel;
use App\Models\ExpectedResultsModel;
use App\Models\FeatureGapsModel;
use App\Models\FileIoTestsModel;
use App\Models\RunsModel;
use App\Models\RunDecisionsModel;
use App\Models\SessionEventsModel;
use App\Models\SessionResultsModel;
use App\Models\SessionsModel;
use App\Models\SettingsModel;
use App\Models\TargetProfilesModel;
use App\Models\TestDataPacksModel;
use App\Models\ValidationResultsModel;
use App\Models\ValidationRulesModel;
use App\Services\Brain\BrainUnavailableException;
use App\Services\WorkerStatusService;
use Config\Environments;
use Config\Products;
use Config\Services;

/**
 * Endpoints used only by the Playwright worker (auth via X-Worker-Token).
 * The worker never speaks user-JWT.
 */
class WorkerController extends BaseApiController
{
    public function nextSession()
    {
        $workerId = $this->resolveWorkerId();
        Services::workerStatus()->recordHeartbeat($workerId);

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

        $template = $this->loadTemplate(
            $profile['product_name'],
            (string) $session['template_code'],
            (string) ($profile['environment'] ?? '')
        );

        // Only send rules declared on this session template — never the full product catalogue.
        $allowedCodes = array_values(array_filter(array_map('strval', (array) ($template['validations'] ?? []))));
        $allRules     = (new ValidationRulesModel())->activeForProduct($profile['product_name']);
        $rules        = $allowedCodes === []
            ? []
            : array_values(array_filter(
                $allRules,
                static fn ($r) => in_array((string) ($r['rule_code'] ?? ''), $allowedCodes, true)
            ));

        // Login sessions do not need accounting data packs / expected ledgers.
        $module = strtolower((string) ($session['module'] ?? $template['module'] ?? ''));
        if ($module === 'login') {
            $pack     = null;
            $expected = [];
        }

        $products = new Products();
        $agentMode = (string) (new SettingsModel())->getSetting('brain.agent_mode', 'template');
        $runtimeContract = [
            'agent_mode' => in_array($agentMode, ['agent', 'template'], true) ? $agentMode : 'template',
            'login' => [
                'jump_to_candidates' => $products->jumpTargetsFor((string) ($profile['product_name'] ?? '')),
                'jump_to_selectors'  => ['select#jumptoe', 'select[name=jumptoe]'],
                'selection_order'    => 'candidate_first',
            ],
            'post_login_host_guard' => [
                'expected_base_url' => (string) ($profile['base_url'] ?? ''),
                'allowed_domains'   => array_values((array) ($profile['allowed_domains'] ?? [])),
                'recovery'          => 'navigate_base_url_once_then_fail',
                'validation_rule'   => 'AUTH_PRODUCT_HOST_MATCH',
            ],
        ];

        // Mark session running and start the QA run clock on first pickup.
        (new SessionsModel())->update($session['id'], ['status' => 'running', 'started_at' => date('Y-m-d H:i:s')]);
        if ($run && in_array($run['status'] ?? '', ['pending', 'running'], true) && empty($run['started_at'])) {
            (new RunsModel())->update($session['qa_run_id'], [
                'status'     => 'running',
                'started_at' => date('Y-m-d H:i:s'),
            ]);
        }

        $this->recordEvent(
            (int) $session['id'],
            (string) $session['qa_run_id'],
            'started',
            'Worker claimed session and started execution: ' . (string) ($session['name'] ?? $session['template_code']),
            ['step_key' => (string) ($session['template_code'] ?? ''), 'metadata' => ['worker_id' => $workerId]]
        );

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
            'runtime_contract' => $runtimeContract,
        ]);
    }

    public function claim(int $sessionId)
    {
        $workerId = $this->resolveWorkerId();
        $now = date('Y-m-d H:i:s');
        $session = (new SessionsModel())->find($sessionId);
        (new SessionsModel())->update($sessionId, [
            'status' => 'claimed',
            'claimed_by_worker' => $workerId,
            'claimed_at' => $now,
            'last_heartbeat_at' => $now,
        ]);
        if ($session) {
            $this->recordEvent(
                $sessionId,
                (string) $session['qa_run_id'],
                'claimed',
                'Session claimed by worker ' . $workerId,
                ['metadata' => ['worker_id' => $workerId]]
            );
        }
        return $this->ok(['claimed' => true]);
    }

    public function heartbeat(int $sessionId)
    {
        $workerId = $this->resolveWorkerId();
        Services::workerStatus()->recordHeartbeat($workerId);

        (new SessionsModel())->update($sessionId, ['last_heartbeat_at' => date('Y-m-d H:i:s')]);

        $session = (new SessionsModel())->find($sessionId);
        $body    = $this->input();
        $message = trim((string) ($body['message'] ?? $body['activity'] ?? ''));

        if ($session && $message !== '') {
            $this->recordEvent(
                $sessionId,
                (string) $session['qa_run_id'],
                'heartbeat',
                $message,
                [
                    'step_key'    => isset($body['step']) ? (string) $body['step'] : null,
                    'step_index'  => $body['step_index'] ?? null,
                    'total_steps' => $body['total_steps'] ?? null,
                    'metadata'    => is_array($body['metadata'] ?? null) ? $body['metadata'] : null,
                ]
            );
        } elseif ($session && in_array($session['status'] ?? '', SessionsModel::LEASED, true)) {
            // Older workers send empty heartbeats — still surface liveness in Live Log (throttled).
            $this->recordThrottledAliveEvent($sessionId, (string) $session['qa_run_id'], $workerId);
        }

        return $this->ok(['ok' => true]);
    }

    public function createDecision()
    {
        $body = $this->input();
        $sessionId = (int) ($body['session_id'] ?? 0);
        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }
        if (! in_array((string) ($session['status'] ?? ''), SessionsModel::LEASED, true)) {
            return $this->fail('Decisions can only be created for an active leased session.', 409);
        }
        $qaRunId = (string) ($body['qa_run_id'] ?? $session['qa_run_id']);
        if ($qaRunId !== (string) $session['qa_run_id']) {
            return $this->fail('qa_run_id does not match session.', 400);
        }
        $situation = trim((string) ($body['situation_key'] ?? ''));
        $question = trim((string) ($body['question'] ?? ''));
        $options = $body['options_json'] ?? $body['options'] ?? null;
        if ($situation === '' || $question === '' || ! is_array($options) || $options === []) {
            return $this->fail('session_id, situation_key, question, and non-empty options_json are required.', 400);
        }
        foreach ($options as $option) {
            if (! is_array($option) || trim((string) ($option['id'] ?? '')) === '' || trim((string) ($option['label'] ?? '')) === '') {
                return $this->fail('Each options_json item requires id and label.', 400);
            }
        }

        $memoryApplied = filter_var($body['memory_applied'] ?? false, FILTER_VALIDATE_BOOL);
        $selected = $memoryApplied ? trim((string) ($body['selected_option'] ?? '')) : null;
        $optionIds = array_map(static fn ($option) => (string) $option['id'], $options);
        if ($memoryApplied && ($selected === '' || ! in_array($selected, $optionIds, true))) {
            return $this->fail('Memory-applied decisions require a valid selected_option.', 400);
        }

        $model = new RunDecisionsModel();
        $id = $model->insert([
            'qa_run_id'       => $qaRunId,
            'session_id'      => $sessionId,
            'situation_key'   => $situation,
            'question'        => $question,
            'options_json'    => array_values($options),
            'context_json'    => is_array($body['context_json'] ?? null) ? $body['context_json'] : null,
            'screenshot_path' => isset($body['screenshot_path']) ? (string) $body['screenshot_path'] : null,
            'status'          => $memoryApplied ? 'answered' : 'pending',
            'selected_option' => $selected,
            'answered_at'     => $memoryApplied ? date('Y-m-d H:i:s') : null,
            'remember'        => $memoryApplied,
            'source'          => $memoryApplied ? 'memory' : 'human',
        ], true);

        if (! $memoryApplied) {
            (new SessionsModel())->update($sessionId, [
                'status'            => 'awaiting_decision',
                'last_heartbeat_at' => date('Y-m-d H:i:s'),
            ]);
        }
        $this->recordEvent(
            $sessionId,
            $qaRunId,
            $memoryApplied ? 'decision_memory_applied' : 'decision_pending',
            $memoryApplied ? 'Remembered decision applied: ' . $selected : 'Waiting for operator decision: ' . $question,
            ['metadata' => ['decision_id' => (int) $id, 'situation_key' => $situation]]
        );

        return $this->ok(['decision' => $model->find($id)], 201);
    }

    public function decision(int $id)
    {
        $row = (new RunDecisionsModel())->find($id);
        if (! $row) {
            return $this->fail('Decision not found.', 404);
        }

        return $this->ok(['decision' => $row]);
    }

    public function timeoutDecision(int $id)
    {
        $model = new RunDecisionsModel();
        $decision = $model->find($id);
        if (! $decision) {
            return $this->fail('Decision not found.', 404);
        }
        if (($decision['status'] ?? '') !== 'pending') {
            return $this->fail('Only pending decisions can time out.', 409);
        }

        $now = date('Y-m-d H:i:s');
        $model->update($id, ['status' => 'timed_out', 'answered_at' => $now]);
        (new SessionsModel())->update((int) $decision['session_id'], [
            'status' => 'failed',
            'completed_at' => $now,
            'last_heartbeat_at' => $now,
        ]);
        $summary = 'Decision timed out after 30 minutes for situation "' . $decision['situation_key'] . '".';
        $results = new SessionResultsModel();
        if (! $results->where('session_id', (int) $decision['session_id'])->first()) {
            $results->insert([
                'session_id' => (int) $decision['session_id'],
                'qa_run_id' => (string) $decision['qa_run_id'],
                'status' => 'failed',
                'severity' => 'high',
                'passed_count' => 0,
                'failed_count' => 1,
                'warning_count' => 0,
                'result_json' => ['fatal_error' => $summary, 'decision_id' => $id],
                'screenshot_paths' => array_values(array_filter([(string) ($decision['screenshot_path'] ?? '')])),
                'console_errors' => [],
                'network_errors' => [],
                'suggested_area' => 'QA worker decision handling',
                'suggested_prompt' => 'Inspect the timed-out decision context and make the blocked path deterministic.',
                'completed_at' => $now,
                'created_at' => $now,
            ]);
        }
        (new ErrorRegisterModel())->upsertSignature([
            'signature' => sha1('decision-timeout|' . $decision['qa_run_id'] . '|' . $decision['session_id'] . '|' . $decision['situation_key']),
            'title' => 'Operator decision timed out: ' . $decision['situation_key'],
            'severity' => 'high',
            'module' => 'worker',
            'last_seen_run_id' => $decision['qa_run_id'],
            'last_session_id' => $decision['session_id'],
            'sample_message' => $summary,
            'human_summary' => $summary,
            'developer_fix_prompt' => 'Reproduce the blocked QA path for situation "' . $decision['situation_key']
                . '", inspect decision ' . $id . ' context/evidence, and add a deterministic safe recovery or clearer operator guidance.',
            'suggested_developer_area' => 'QA worker decision handling',
        ]);
        $this->recordEvent(
            (int) $decision['session_id'],
            (string) $decision['qa_run_id'],
            'decision_timed_out',
            $summary,
            ['metadata' => ['decision_id' => $id, 'situation_key' => $decision['situation_key']]]
        );
        Services::reportService()->buildSessionReport((int) $decision['session_id']);
        $remaining = (new SessionsModel())->where('qa_run_id', $decision['qa_run_id'])
            ->whereIn('status', SessionsModel::ACTIVE)->countAllResults();
        if ($remaining === 0) {
            Services::reportService()->buildFinalReport((string) $decision['qa_run_id']);
        }

        return $this->ok(['decision' => $model->find($id)]);
    }

    public function decisionMemory()
    {
        $product = trim((string) ($this->request->getGet('product_name') ?? ''));
        $environment = trim((string) ($this->request->getGet('environment') ?? ''));
        $situation = trim((string) ($this->request->getGet('situation_key') ?? ''));
        if ($product === '' || $environment === '' || $situation === '') {
            return $this->fail('product_name, environment, and situation_key are required.', 400);
        }
        // Memory rows are stored on canonical tiers, so a worker still sending a
        // legacy value (gh / prod_basic / prod_full) must not silently miss.
        $row = (new DecisionMemoryModel())
            ->where('product_name', $product)
            ->where('environment', Environments::normalize($environment))
            ->where('situation_key', $situation)
            ->first();

        return $this->ok(['memory' => $row]);
    }

    /**
     * Proxies one Brain call for the worker's vision agent / council tasks.
     * Provider keys never leave this API — the worker only ever sees this
     * endpoint plus the final decision JSON.
     */
    public function brainInvoke()
    {
        $body = $this->input();
        $task = (string) ($body['task'] ?? '');
        $systemPrompt = (string) ($body['system_prompt'] ?? '');
        $userPrompt = (string) ($body['user_prompt'] ?? '');
        $context = is_array($body['context'] ?? null) ? $body['context'] : [];
        $images = is_array($body['images'] ?? null) ? $body['images'] : [];

        try {
            $result = $images !== []
                ? Services::brain()->invokeVision($task, $systemPrompt, $userPrompt, $images, $context)
                : Services::brain()->invoke($task, $systemPrompt, $userPrompt, $context);
        } catch (BrainUnavailableException $e) {
            return $this->response->setStatusCode(503)->setJSON([
                'ok'       => false,
                'error'    => 'brain_unavailable',
                'provider' => $e->provider ?? 'unknown',
                'detail'   => $e->getMessage(),
            ]);
        }

        return $this->ok($result);
    }

    /**
     * Provider configuration health check, surfaced in Settings and used by the
     * worker to pre-flight a session before it launches a browser.
     */
    public function brainHealth()
    {
        $providers = Services::brain()->providerHealth();
        $visionAvailable = false;
        foreach ($providers as $provider) {
            if (! empty($provider['vision_capable'])
                && ! empty($provider['enabled_for_vision'])
                && ! empty($provider['configured'])) {
                $visionAvailable = true;
                break;
            }
        }

        return $this->ok([
            'vision_available' => $visionAvailable,
            'vision_providers' => $providers,
        ]);
    }

    /**
     * Worker posts live activity while executing a session (step text, progress).
     */
    public function progress(int $sessionId)
    {
        $workerId = $this->resolveWorkerId();
        Services::workerStatus()->recordHeartbeat($workerId);

        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }
        $body = $this->input();
        $message = trim((string) ($body['message'] ?? $body['activity'] ?? ''));
        if ($message === '') {
            return $this->fail('message is required.', 400);
        }

        (new SessionsModel())->update($sessionId, [
            'status'             => in_array($session['status'] ?? '', ['queued', 'claimed'], true) ? 'running' : $session['status'],
            'last_heartbeat_at'  => date('Y-m-d H:i:s'),
        ]);

        $eventType = trim((string) ($body['event_type'] ?? 'progress'));
        if ($eventType === '') {
            $eventType = 'progress';
        }

        $this->recordEvent(
            $sessionId,
            (string) $session['qa_run_id'],
            $eventType,
            $message,
            [
                'step_key'    => isset($body['step']) ? (string) $body['step'] : null,
                'step_index'  => $body['step_index'] ?? null,
                'total_steps' => $body['total_steps'] ?? null,
                'metadata'    => is_array($body['metadata'] ?? null) ? $body['metadata'] : null,
            ]
        );

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
        try {
            (new RunDecisionsModel())
                ->where('session_id', $sessionId)
                ->where('status', 'pending')
                ->set(['status' => 'cancelled'])
                ->update();
        } catch (\Throwable $e) {
            // Decisions table may not exist yet on older deploys.
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
            'result_json'      => $body['result_json'] ?? [],
            'screenshot_paths' => $body['screenshot_paths'] ?? [],
            'trace_path'       => $body['trace_path'] ?? null,
            'console_errors'   => $body['console_errors'] ?? [],
            'network_errors'   => $body['network_errors'] ?? [],
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

            // Roll up to error register on failure (per-rule — not the whole-session rule dump).
            if (empty($v['passed'])) {
                $ruleCode = (string) ($v['rule_code'] ?? '');
                $module   = (string) ($session['module'] ?? 'unknown');
                $notes    = trim((string) ($v['notes'] ?? ''));
                $expected = isset($v['expected']) ? (string) $v['expected'] : '';
                $actual   = isset($v['actual']) ? (string) $v['actual'] : '';
                $sample   = $notes !== ''
                    ? $notes
                    : trim('expected=' . $expected . ' actual=' . $actual, ' =');
                $humanSummary = ($ruleCode !== '' ? $ruleCode : 'Validation')
                    . ' failed' . ($actual !== '' ? ': actual "' . $actual . '"' : '')
                    . ($expected !== '' ? ' instead of expected "' . $expected . '".' : '.');
                $evidence = array_values(array_filter(array_map(
                    'strval',
                    (array) ($body['screenshot_paths'] ?? [])
                )));
                $evidenceText = $evidence !== [] ? implode(', ', $evidence) : 'session report and captured trace/console/network evidence';
                $developerPrompt = 'Fix failed QA rule ' . ($ruleCode !== '' ? $ruleCode : 'unknown')
                    . ' in the ' . $module . ' module. Expected: ' . ($expected !== '' ? $expected : '(not supplied)')
                    . '. Actual: ' . ($actual !== '' ? $actual : '(not supplied)')
                    . '. Evidence: ' . $evidenceText
                    . '. Reproduce the failure, identify the root cause, implement the smallest safe fix, and add or update regression coverage.';

                (new ErrorRegisterModel())->upsertSignature([
                    'signature'                => sha1($ruleCode . '|' . $expected . '|' . $actual),
                    'title'                    => 'Failed: ' . ($ruleCode !== '' ? $ruleCode : 'unknown'),
                    'severity'                 => (string) ($v['severity'] ?? 'medium'),
                    'product_name'             => $body['product_name'] ?? null,
                    'module'                   => $session['module'] ?? null,
                    'last_seen_run_id'         => $session['qa_run_id'],
                    'last_session_id'          => $sessionId,
                    'sample_message'           => $sample !== '' ? $sample : null,
                    'human_summary'            => $humanSummary,
                    'developer_fix_prompt'     => $developerPrompt,
                    'suggested_developer_area' => 'Likely area: ' . $module
                        . ' module — investigate rule ' . ($ruleCode !== '' ? $ruleCode : 'unknown') . '.',
                ]);
            }
        }

        $finalStatus = in_array($status, ['passed', 'failed', 'skipped', 'partial'], true)
            ? ($status === 'passed' ? 'completed' : $status)
            : 'completed';

        // A result can land after the operator cancelled the run. Keep the evidence,
        // but never resurrect a cancelled session into a completed one.
        $wasCancelled = (string) ($session['status'] ?? '') === 'cancelled';
        if ($wasCancelled) {
            $finalStatus = 'cancelled';
        }

        (new SessionsModel())->update($sessionId, [
            'status'       => $finalStatus,
            'completed_at' => date('Y-m-d H:i:s'),
        ]);

        $module = strtolower((string) ($session['module'] ?? ''));
        $isLogin = $module === 'login' || str_contains(strtolower((string) ($session['template_code'] ?? '')), 'login');
        $okLogin = in_array($status, ['passed', 'completed'], true)
            || ($status === 'partial' && $failed === 0);
        $doneMsg = $isLogin
            ? ($okLogin
                ? 'LOGIN SUCCESSFUL — Smart Books sign-in completed (' . $status . ').'
                : 'LOGIN FAILED / INCOMPLETE — status ' . $status . ' (severity: ' . $severity . '). Check credentials, Jump To → Smart Books, OTP/challenge state, login URL, and View log screenshots.')
            : 'Session finished with status: ' . $status . ' (severity: ' . $severity . ')';
        if ($wasCancelled) {
            $doneMsg = 'Worker reported "' . $status . '" after the QA run was cancelled. '
                . 'The result and its evidence were kept; the session stays cancelled.';
        }

        $this->recordEvent(
            $sessionId,
            (string) $session['qa_run_id'],
            $wasCancelled ? 'cancelled' : ($okLogin && $isLogin ? 'login_success' : 'completed'),
            $doneMsg,
            ['metadata' => [
                'status'        => $status,
                'severity'      => $severity,
                'passed'        => $passed,
                'failed'        => $failed,
                'was_cancelled' => $wasCancelled,
            ]]
        );

        // Generate the session-level report.
        $report = Services::reportService()->buildSessionReport($sessionId);

        Services::auditService()->log('session_execution_complete', [
            'qa_run_id'  => $session['qa_run_id'],
            'session_id' => $sessionId,
            'metadata'   => ['status' => $status, 'severity' => $severity],
        ]);

        // If no queued sessions remain for this run, build the final consolidated report.
        $remaining = (new SessionsModel())->where('qa_run_id', $session['qa_run_id'])
            ->whereIn('status', SessionsModel::ACTIVE)->countAllResults();
        if ($remaining === 0) {
            Services::reportService()->buildFinalReport($session['qa_run_id']);
        }

        return $this->ok(['report' => $report]);
    }

    public function ping()
    {
        $workerId = $this->resolveWorkerId();
        $body     = $this->input();
        $package  = trim((string) ($body['package'] ?? ''));
        Services::workerStatus()->recordHeartbeat(
            $workerId,
            $package !== '' ? $package : null
        );

        return $this->ok(['ok' => true, 'worker_id' => $workerId]);
    }

    public function uploadEvidence(int $sessionId)
    {
        $file = $this->request->getFile('file');
        $kind = (string) ($this->request->getPost('kind') ?? 'screenshot');
        if (! $file || ! $file->isValid()) {
            $err = $file ? $file->getErrorString() : 'No file field in upload.';
            return $this->fail('No file uploaded. ' . $err, 400);
        }
        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }
        $run = (new RunsModel())->find($session['qa_run_id']);
        $dir = Services::reportService()->sessionScreenshotsDirectory($session, $run ?: null);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return $this->fail('Cannot create evidence directory on API host. Check QA_REPORTS_DIR permissions.', 500);
        }

        // Keep a readable name (001-after-login.png) instead of a random hash.
        $client = (string) $file->getClientName();
        $safe   = preg_replace('/[^a-zA-Z0-9._-]+/', '-', $client) ?: '';
        $safe   = trim((string) $safe, '.-');
        if ($safe === '') {
            $safe = $file->getRandomName();
        }
        // Avoid overwrite collisions on re-upload.
        $name = $safe;
        $i    = 1;
        while (is_file($dir . '/' . $name)) {
            $name = pathinfo($safe, PATHINFO_FILENAME) . '-' . $i . '.' . (pathinfo($safe, PATHINFO_EXTENSION) ?: 'png');
            $i++;
        }

        if (! $file->hasMoved()) {
            $file->move($dir, $name);
        }
        $path = $dir . '/' . $name;

        Services::auditService()->log('screenshot_captured', [
            'qa_run_id'  => $session['qa_run_id'],
            'session_id' => $sessionId,
            'metadata'   => ['kind' => $kind, 'path' => $path, 'filename' => $name],
        ]);

        $label = $kind !== '' ? $kind : 'evidence';
        $this->recordEvent(
            $sessionId,
            (string) $session['qa_run_id'],
            'evidence',
            'Uploaded ' . $label . ': ' . $name,
            ['metadata' => ['kind' => $kind, 'filename' => $name, 'path' => $path]]
        );

        return $this->ok(['path' => $path, 'filename' => $name]);
    }

    /**
     * Worker posts one file I/O scenario verdict: hash/MIME/structure comparison
     * plus QA's data verification (row counts, key cells, numeric totals).
     */
    public function postFileIo(int $sessionId)
    {
        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }

        $body     = $this->input();
        $scenario = trim((string) ($body['scenario_key'] ?? ''));
        if ($scenario === '') {
            return $this->fail('scenario_key is required.', 400);
        }

        $status = (string) ($body['compare_status'] ?? 'skipped');
        if (! in_array($status, FileIoTestsModel::STATUSES, true)) {
            return $this->fail('compare_status must be one of: ' . implode(', ', FileIoTestsModel::STATUSES), 422);
        }
        $direction = (string) ($body['direction'] ?? 'round_trip');
        if (! in_array($direction, FileIoTestsModel::DIRECTIONS, true)) {
            return $this->fail('direction must be one of: ' . implode(', ', FileIoTestsModel::DIRECTIONS), 422);
        }

        $run   = (new RunsModel())->find($session['qa_run_id']);

        // `artifact_paths` are worker-local. Keep only the ones this host can actually
        // read, so GET /runs/{id}/file-io never advertises an artifact_key the portal
        // cannot serve. When the worker runs elsewhere the follow-up multipart upload
        // to /worker/file-io/{id}/artifact is what fills these in.
        $workerPaths = is_array($body['artifact_paths'] ?? null) ? $body['artifact_paths'] : [];
        $localPaths  = [];
        foreach ($workerPaths as $key => $path) {
            if (is_string($path) && $path !== '' && is_file($path)) {
                $localPaths[(string) $key] = $path;
            }
        }

        $evidence = is_array($body['evidence'] ?? null) ? $body['evidence'] : [];
        if ($workerPaths !== []) {
            $evidence['worker_artifact_paths'] = $workerPaths;
        }

        $tests = new FileIoTestsModel();
        $testId = $tests->record([
            'qa_run_id'           => (string) $session['qa_run_id'],
            'session_id'          => $sessionId,
            'product_name'        => (string) ($run['product_name'] ?? 'unknown'),
            'scenario_key'        => $scenario,
            'direction'           => $direction,
            'fixture_name'        => isset($body['fixture_name']) ? (string) $body['fixture_name'] : null,
            'upload_ok'           => (bool) ($body['upload_ok'] ?? false),
            'download_ok'         => (bool) ($body['download_ok'] ?? false),
            'compare_status'      => $status,
            'source_sha256'       => $body['source_sha256'] ?? null,
            'result_sha256'       => $body['result_sha256'] ?? null,
            'source_mime'         => $body['source_mime'] ?? null,
            'result_mime'         => $body['result_mime'] ?? null,
            'source_bytes'        => isset($body['source_bytes']) ? (int) $body['source_bytes'] : null,
            'result_bytes'        => isset($body['result_bytes']) ? (int) $body['result_bytes'] : null,
            'structure_ok'        => (bool) ($body['structure_ok'] ?? false),
            'structure_notes'     => $body['structure_notes'] ?? null,
            'rows_expected'       => isset($body['rows_expected']) ? (int) $body['rows_expected'] : null,
            'rows_found'          => isset($body['rows_found']) ? (int) $body['rows_found'] : null,
            'mismatched_cells'    => isset($body['mismatched_cells']) ? (int) $body['mismatched_cells'] : null,
            'mismatches_json'     => is_array($body['mismatches'] ?? null) ? $body['mismatches'] : null,
            'totals_expected'     => is_array($body['totals_expected'] ?? null) ? $body['totals_expected'] : null,
            'totals_found'        => is_array($body['totals_found'] ?? null) ? $body['totals_found'] : null,
            'data_verified'       => array_key_exists('data_verified', $body) && $body['data_verified'] !== null
                ? (bool) $body['data_verified']
                : null,
            'verification_notes'  => $body['verification_notes'] ?? null,
            'artifact_paths_json' => $localPaths !== [] ? $localPaths : null,
            'evidence_json'       => $evidence !== [] ? $evidence : null,
        ]);

        $this->recordEvent(
            $sessionId,
            (string) $session['qa_run_id'],
            'file_io',
            'File I/O scenario "' . $scenario . '" finished with status ' . $status . '.',
            ['metadata' => [
                'scenario_key'   => $scenario,
                'direction'      => $direction,
                'compare_status' => $status,
                'data_verified'  => $body['data_verified'] ?? null,
            ]]
        );

        return $this->ok(['id' => $testId, 'file_io_test' => $tests->find($testId)], 201);
    }

    /**
     * Worker posts heuristic + AI-refined feature-gap findings for one session
     * (the ported feature_gap review). Enrichment only — the worker never lets
     * this block a session, so failures here should not either.
     */
    public function postFeatureGaps(int $sessionId)
    {
        $session = (new SessionsModel())->find($sessionId);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }

        $body = $this->input();
        $gaps = is_array($body['gaps'] ?? null) ? $body['gaps'] : [];
        if ($gaps === []) {
            return $this->fail('gaps is required and must be a non-empty array.', 400);
        }

        $run         = (new RunsModel())->find($session['qa_run_id']);
        $productName = (string) ($run['product_name'] ?? 'unknown');

        $model    = new FeatureGapsModel();
        $inserted = [];
        foreach ($gaps as $gap) {
            if (! is_array($gap)) {
                continue;
            }
            $expectedFeature = trim((string) ($gap['expected_feature'] ?? ''));
            if ($expectedFeature === '') {
                continue;
            }
            $id = $model->insert([
                'qa_run_id'        => (string) $session['qa_run_id'],
                'session_id'       => $sessionId,
                'product_name'     => trim((string) ($gap['product_name'] ?? '')) !== '' ? (string) $gap['product_name'] : $productName,
                'expected_feature' => $expectedFeature,
                'observed'         => (bool) ($gap['observed'] ?? false),
                'severity'         => (string) ($gap['severity'] ?? 'medium'),
                'confidence'       => (string) ($gap['confidence'] ?? 'low'),
                'recommendation'   => isset($gap['recommendation']) ? (string) $gap['recommendation'] : null,
                'sources_json'     => is_array($gap['sources'] ?? null) ? $gap['sources'] : null,
                'evidence_json'    => is_array($gap['evidence'] ?? null) ? $gap['evidence'] : null,
                'created_at'       => date('Y-m-d H:i:s'),
            ], true);
            $inserted[] = (int) $id;
        }

        $this->recordEvent(
            $sessionId,
            (string) $session['qa_run_id'],
            'feature_gaps',
            'Recorded ' . count($inserted) . ' feature-gap finding(s).',
            ['metadata' => ['count' => count($inserted)]]
        );

        return $this->ok(['inserted' => count($inserted), 'ids' => $inserted], 201);
    }

    /**
     * Worker uploads one artifact belonging to a file I/O test (fixture or download),
     * so the portal can serve it later even when the worker host is elsewhere.
     */
    public function uploadFileIoArtifact(int $testId)
    {
        $tests = new FileIoTestsModel();
        $test  = $tests->find($testId);
        if (! $test) {
            return $this->fail('File I/O test not found.', 404);
        }

        $file = $this->request->getFile('file');
        $key  = trim((string) ($this->request->getPost('key') ?? 'artifact'));
        if (! $file || ! $file->isValid()) {
            return $this->fail('No file uploaded. ' . ($file ? $file->getErrorString() : ''), 400);
        }

        $session = (new SessionsModel())->find((int) $test['session_id']);
        if (! $session) {
            return $this->fail('Session not found.', 404);
        }
        $run = (new RunsModel())->find($session['qa_run_id']);
        $dir = Services::reportService()->sessionFileIoDirectory($session, $run ?: null)
            . '/' . preg_replace('/[^a-z0-9._-]+/i', '-', (string) $test['scenario_key']);
        if (! is_dir($dir) && ! @mkdir($dir, 0775, true) && ! is_dir($dir)) {
            return $this->fail('Cannot create file I/O directory on API host. Check QA_REPORTS_DIR permissions.', 500);
        }

        $safe = preg_replace('/[^a-zA-Z0-9._-]+/', '-', (string) $file->getClientName()) ?: $file->getRandomName();
        $name = preg_replace('/[^a-z0-9._-]+/i', '-', $key) . '-' . trim((string) $safe, '.-');
        if (! $file->hasMoved()) {
            $file->move($dir, $name, true);
        }

        $paths = is_array($test['artifact_paths_json'] ?? null) ? $test['artifact_paths_json'] : [];
        $paths[$key] = $dir . '/' . $name;
        $tests->update($testId, ['artifact_paths_json' => $paths]);

        return $this->ok(['key' => $key, 'path' => $paths[$key]]);
    }

    /**
     * Prefer dedicated worker identity from query / header / body.
     * Never fall back to PHP gethostname() (legacy shared host confusion).
     */
    private function resolveWorkerId(): string
    {
        $candidates = [
            $this->request->getGet('worker_id'),
            $this->request->getHeaderLine('X-Worker-Id'),
        ];
        $body = $this->input();
        if (is_array($body)) {
            $candidates[] = $body['worker_id'] ?? null;
        }

        foreach ($candidates as $raw) {
            $id = trim((string) $raw);
            if ($id !== '') {
                return $id;
            }
        }

        return WorkerStatusService::DEFAULT_WORKER_ID;
    }

    private function recordEvent(int $sessionId, string $qaRunId, string $type, string $message, array $extra = []): void
    {
        try {
            (new SessionEventsModel())->record($sessionId, $qaRunId, $type, $message, $extra);
        } catch (\Throwable $e) {
            log_message('error', 'Failed to record session event: {msg}', ['msg' => $e->getMessage()]);
        }
    }

    /** At most one alive line every 25s so empty-heartbeat workers still update Live Log. */
    private function recordThrottledAliveEvent(int $sessionId, string $qaRunId, string $workerId): void
    {
        try {
            $last = (new SessionEventsModel())
                ->where('session_id', $sessionId)
                ->orderBy('id', 'DESC')
                ->first();

            if ($last && ! empty($last['created_at'])) {
                $age = time() - strtotime((string) $last['created_at']);
                if ($age >= 0 && $age < 25) {
                    return;
                }
            }

            $this->recordEvent(
                $sessionId,
                $qaRunId,
                'alive',
                'Worker is still running this session (browser login in progress). For step-by-step logs, deploy the latest Playwright worker and restart PM2.',
                ['metadata' => ['worker_id' => $workerId]]
            );
        } catch (\Throwable $e) {
            log_message('error', 'Failed to record alive event: {msg}', ['msg' => $e->getMessage()]);
        }
    }

    private function loadTemplate(string $product, string $code, string $environment = ''): ?array
    {
        if ($code === '') {
            return null;
        }
        $file = APPPATH . 'Database/Templates/' . $product . '/' . $code . '.json';
        if (! is_file($file)) {
            return null;
        }

        $tpl = json_decode((string) file_get_contents($file), true);
        if (! is_array($tpl)) {
            return null;
        }

        // Prefer env-specific steps (observer-only tiers = login only, no company create).
        // Templates authored before the five-tier rename still key on gh/prod_basic/prod_full.
        $byEnv = $tpl['steps_by_env'] ?? null;
        if (is_array($byEnv) && $environment !== '') {
            foreach (Environments::templateKeys($environment) as $key) {
                if (! empty($byEnv[$key]) && is_array($byEnv[$key])) {
                    $tpl['steps'] = $byEnv[$key];
                    break;
                }
            }
        }

        return $tpl;
    }
}
