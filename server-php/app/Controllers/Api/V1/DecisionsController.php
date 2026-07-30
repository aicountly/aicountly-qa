<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\DecisionMemoryModel;
use App\Models\ErrorRegisterModel;
use App\Models\RunDecisionsModel;
use App\Models\RunsModel;
use App\Models\SessionEventsModel;
use App\Models\SessionsModel;
use Config\Environments;
use Config\Services;

class DecisionsController extends BaseApiController
{
    public function index(string $qaRunId)
    {
        if (! (new RunsModel())->find($qaRunId)) {
            return $this->fail('QA run not found.', 404);
        }
        $model = (new RunDecisionsModel())->where('qa_run_id', $qaRunId);
        $status = trim((string) ($this->request->getGet('status') ?? ''));
        if ($status !== '') {
            if (! in_array($status, ['pending', 'answered', 'timed_out', 'cancelled'], true)) {
                return $this->fail('Invalid decision status.', 400);
            }
            $model->where('status', $status);
        }

        return $this->ok($model->orderBy('created_at', 'ASC')->findAll());
    }

    public function answer(string $qaRunId, int $id)
    {
        $model = new RunDecisionsModel();
        $decision = $model->find($id);
        if (! $decision || (string) $decision['qa_run_id'] !== $qaRunId) {
            return $this->fail('Decision not found.', 404);
        }
        if (($decision['status'] ?? '') !== 'pending') {
            return $this->fail('Only pending decisions can be answered.', 409);
        }

        $body = $this->input();
        $selected = trim((string) ($body['selected_option'] ?? ''));
        $optionIds = array_values(array_filter(array_map(
            static fn ($option) => is_array($option) ? (string) ($option['id'] ?? '') : '',
            (array) ($decision['options_json'] ?? [])
        )));
        if ($selected === '' || ! in_array($selected, $optionIds, true)) {
            return $this->fail('selected_option must match a decision option id.', 400);
        }

        $remember = filter_var($body['remember'] ?? false, FILTER_VALIDATE_BOOL);
        $userId = isset($this->user()['id']) ? (int) $this->user()['id'] : null;
        $now = date('Y-m-d H:i:s');
        $db = $model->db;
        $db->transStart();
        $model->update($id, [
            'status'          => 'answered',
            'selected_option' => $selected,
            'free_text'       => isset($body['free_text']) ? trim((string) $body['free_text']) : null,
            'answered_by'     => $userId,
            'answered_at'     => $now,
            'remember'        => $remember,
            'source'          => 'human',
        ]);

        $session = (new SessionsModel())->find((int) $decision['session_id']);
        if ($session && ($session['status'] ?? '') === 'awaiting_decision') {
            $resumeStatus = ! empty($session['started_at']) ? 'running' : 'claimed';
            (new SessionsModel())->update((int) $session['id'], [
                'status'            => $resumeStatus,
                'last_heartbeat_at' => $now,
            ]);
        }

        if ($remember) {
            $run = (new RunsModel())->find($qaRunId);
            (new DecisionMemoryModel())->remember([
                'product_name'  => (string) ($run['product_name'] ?? ''),
                // Canonical tier only: a run row written before the five-tier
                // migration would otherwise create a second memory key.
                'environment'   => Environments::normalize((string) ($run['environment'] ?? '')),
                'situation_key' => (string) $decision['situation_key'],
            ], $selected, is_array($body['memory_payload'] ?? null) ? $body['memory_payload'] : null, $userId);
        }
        $db->transComplete();
        if (! $db->transStatus()) {
            return $this->fail('Failed to answer decision.', 500);
        }

        $this->recordDecisionEvent($decision, 'decision_answered', 'Decision answered: ' . $selected);
        if (in_array($selected, ['abort_session', 'mark_blocked'], true)) {
            $this->recordBlockedError($decision, $selected, (string) ($body['free_text'] ?? ''));
        }
        $this->audit('run_decision_answered', [
            'qa_run_id' => $qaRunId,
            'session_id' => (int) $decision['session_id'],
            'subject_kind' => 'run_decision',
            'subject_id' => $id,
            'metadata' => ['selected_option' => $selected, 'remember' => $remember],
        ]);

        return $this->ok($model->find($id));
    }

    public function screenshot(string $qaRunId, int $id)
    {
        $decision = (new RunDecisionsModel())->find($id);
        if (! $decision || (string) $decision['qa_run_id'] !== $qaRunId) {
            return $this->fail('Decision not found.', 404);
        }
        $path = (string) ($decision['screenshot_path'] ?? '');
        $real = $path !== '' ? realpath($path) : false;
        $root = realpath(Services::reportService()->reportsRoot());
        if ($real === false || $root === false || ! str_starts_with($real, rtrim($root, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR) || ! is_file($real)) {
            return $this->fail('Decision screenshot not found.', 404);
        }
        $mime = mime_content_type($real) ?: 'application/octet-stream';
        if (! str_starts_with($mime, 'image/')) {
            return $this->fail('Decision evidence is not an image.', 415);
        }
        $raw = file_get_contents($real);
        if ($raw === false) {
            return $this->fail('Decision screenshot unreadable.', 500);
        }

        return $this->response
            ->setHeader('Content-Type', $mime)
            ->setHeader('Content-Length', (string) strlen($raw))
            ->setHeader('X-Content-Type-Options', 'nosniff')
            ->setBody($raw);
    }

    private function recordDecisionEvent(array $decision, string $type, string $message): void
    {
        try {
            (new SessionEventsModel())->record(
                (int) $decision['session_id'],
                (string) $decision['qa_run_id'],
                $type,
                $message,
                ['metadata' => ['decision_id' => (int) $decision['id'], 'situation_key' => $decision['situation_key']]]
            );
        } catch (\Throwable $e) {
            log_message('error', 'Failed to record decision event: {msg}', ['msg' => $e->getMessage()]);
        }
    }

    private function recordBlockedError(array $decision, string $selected, string $note): void
    {
        $summary = 'Session blocked by operator decision "' . $selected . '" for ' . $decision['situation_key'] . '.';
        (new ErrorRegisterModel())->upsertSignature([
            'signature' => sha1('decision|' . $decision['qa_run_id'] . '|' . $decision['session_id'] . '|' . $decision['situation_key']),
            'title' => 'Decision blocked session: ' . $decision['situation_key'],
            'severity' => $selected === 'abort_session' ? 'high' : 'medium',
            'module' => 'worker',
            'last_seen_run_id' => $decision['qa_run_id'],
            'last_session_id' => $decision['session_id'],
            'sample_message' => trim($summary . ' ' . $note),
            'human_summary' => $summary,
            'developer_fix_prompt' => 'Investigate why QA situation "' . $decision['situation_key']
                . '" required operator action. Use decision ' . $decision['id']
                . ' context and screenshot evidence, reproduce safely, and make the worker path deterministic.',
            'suggested_developer_area' => 'QA worker decision handling',
        ]);
    }
}
