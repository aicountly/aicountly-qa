<?php

namespace App\Models;

use CodeIgniter\Model;
use Config\Services;

class SessionsModel extends Model
{
    protected $table         = 'qa_sessions';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;

    protected $allowedFields = [
        'qa_run_id', 'session_plan_id', 'name', 'template_code',
        'module', 'sub_module', 'order_index', 'scope_json',
        'status', 'claimed_by_worker', 'claimed_at',
        'started_at', 'completed_at', 'last_heartbeat_at',
    ];

    protected $afterFind = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if (array_key_exists('scope_json', $data['data']) && is_array($data['data']['scope_json'])) {
            $data['data']['scope_json'] = json_encode($data['data']['scope_json']);
        }

        return $data;
    }

    protected function decodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if ($data['singleton']) {
            $data['data'] = $this->decodeJsonRow($data['data']);

            return $data;
        }

        foreach ($data['data'] as $i => $row) {
            if (is_array($row)) {
                $data['data'][$i] = $this->decodeJsonRow($row);
            }
        }

        return $data;
    }

    private function decodeJsonRow(array $row): array
    {
        if (array_key_exists('scope_json', $row)) {
            $row['scope_json'] = $this->decodeJsonValue($row['scope_json']);
        }

        return $row;
    }

    /** @return array<string, mixed>|null */
    public function decodeJsonValue(mixed $raw): ?array
    {
        if ($raw === null) {
            return null;
        }

        $value = $raw;

        for ($i = 0; $i < 2; $i++) {
            if (is_array($value)) {
                return $value;
            }
            if ($value === '') {
                return null;
            }
            if (! is_string($value)) {
                break;
            }

            $decoded = json_decode($value, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                break;
            }

            $value = $decoded;
        }

        return is_array($value) ? $value : null;
    }

    /**
     * Atomically claim the next queued session for a worker.
     * Uses Postgres SKIP LOCKED so multiple workers (if ever introduced) never grab
     * the same row, even though in MVP only one worker should run at a time.
     */
    public function claimNext(string $workerId): ?array
    {
        $this->recoverStaleSessions();

        $db = $this->db;
        $db->transStart();

        $sql = "WITH cte AS (
                  SELECT id
                  FROM qa_sessions
                  WHERE status = 'queued'
                  ORDER BY order_index ASC, id ASC
                  LIMIT 1
                  FOR UPDATE SKIP LOCKED
                )
                UPDATE qa_sessions s
                SET status = 'claimed',
                    claimed_by_worker = ?,
                    claimed_at = CURRENT_TIMESTAMP,
                    last_heartbeat_at = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                FROM cte
                WHERE s.id = cte.id
                RETURNING s.*;";

        $result = $db->query($sql, [$workerId]);
        $row    = $result ? $result->getRowArray() : null;

        $db->transComplete();

        if (! $row) {
            return null;
        }

        if (array_key_exists('scope_json', $row)) {
            $row['scope_json'] = $this->decodeJsonValue($row['scope_json']);
        }

        return $row;
    }

    /**
     * Recover sessions abandoned after a worker crash / restart.
     * - claimed too long → re-queue
     * - running with stale heartbeat → mark failed + close the run when nothing remains
     *
     * @return list<string> QA run IDs that had stale running sessions failed
     */
    public function recoverStaleSessions(int $claimedMinutes = 10, int $runningMinutes = 15): array
    {
        $claimedMinutes  = max(1, $claimedMinutes);
        $runningMinutes  = max(1, $runningMinutes);

        $this->requeueStaleClaims($claimedMinutes);

        $result = $this->db->query(
            "UPDATE qa_sessions
             SET status = 'failed',
                 completed_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = 'running'
             AND COALESCE(last_heartbeat_at, started_at, updated_at, created_at)
                 < (CURRENT_TIMESTAMP - INTERVAL '{$runningMinutes} minutes')
             RETURNING id, qa_run_id, started_at"
        );

        $failedRows = $result ? $result->getResultArray() : [];
        if ($failedRows === []) {
            return [];
        }

        $resultsModel = new SessionResultsModel();
        $runIds       = [];

        foreach ($failedRows as $row) {
            $sessionId = (int) $row['id'];
            $qaRunId   = (string) $row['qa_run_id'];
            $runIds[]  = $qaRunId;

            $existing = $resultsModel->where('session_id', $sessionId)->first();
            if ($existing) {
                continue;
            }

            $resultsModel->insert([
                'session_id'       => $sessionId,
                'qa_run_id'        => $qaRunId,
                'status'           => 'failed',
                'severity'         => 'high',
                'passed_count'     => 0,
                'failed_count'     => 1,
                'warning_count'    => 0,
                'result_json'      => [
                    'fatal_error' => 'Session timed out: the QA worker stopped reporting progress. The session was marked failed automatically.',
                ],
                'screenshot_paths' => [],
                'console_errors'   => [],
                'network_errors'   => [],
                'suggested_area'   => 'QA worker / infrastructure',
                'suggested_prompt' => 'Check that the Playwright worker is running and can complete sessions without crashing.',
                'started_at'       => $row['started_at'] ?? null,
                'completed_at'     => date('Y-m-d H:i:s'),
                'created_at'       => date('Y-m-d H:i:s'),
            ]);
        }

        $runIds = array_values(array_unique($runIds));

        foreach ($runIds as $qaRunId) {
            $remaining = (int) $this->db->table('qa_sessions')
                ->where('qa_run_id', $qaRunId)
                ->whereIn('status', ['queued', 'claimed', 'running'])
                ->countAllResults();

            if ($remaining === 0) {
                Services::reportService()->buildFinalReport($qaRunId);
            }
        }

        return $runIds;
    }

    /** Re-queue sessions left in claimed state after a worker crash. */
    public function requeueStaleClaims(int $minutes = 10): void
    {
        $minutes = max(1, $minutes);

        $this->db->query(
            "UPDATE qa_sessions
             SET status = 'queued',
                 claimed_by_worker = NULL,
                 claimed_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = 'claimed'
             AND claimed_at IS NOT NULL
             AND claimed_at < (CURRENT_TIMESTAMP - INTERVAL '{$minutes} minutes')"
        );
    }

    /** Statuses that may be manually re-queued for another worker attempt. */
    public const RERUNNABLE = ['completed', 'failed', 'skipped', 'partial', 'blocked_by_safe_guard'];

    /**
     * Reset a finished session to queued and clear prior DB result artifacts.
     * Screenshots/evidence files on disk are intentionally kept until the QA run is deleted.
     *
     * @return array{session: array, previous_status: string}
     */
    public function prepareRerun(int $sessionId): array
    {
        $session = $this->find($sessionId);
        if (! $session) {
            throw new \RuntimeException('Session not found.', 404);
        }

        $status = (string) ($session['status'] ?? '');
        if (in_array($status, ['queued', 'claimed', 'running'], true)) {
            throw new \RuntimeException('Session is already queued or in progress.', 409);
        }
        if (! in_array($status, self::RERUNNABLE, true)) {
            throw new \RuntimeException('Session status "' . $status . '" cannot be re-run.', 400);
        }

        $qaRunId = (string) $session['qa_run_id'];
        $db      = $this->db;
        $db->transStart();

        $db->table('qa_session_results')->where('session_id', $sessionId)->delete();
        $db->table('qa_validation_results')->where('session_id', $sessionId)->delete();
        try {
            $db->table('qa_session_events')->where('session_id', $sessionId)->delete();
        } catch (\Throwable $e) {
            // Table may not exist yet on older deploys.
        }
        $db->table('qa_reports')->where('session_id', $sessionId)->where('kind', 'session')->delete();
        // Invalidate consolidated final report so it rebuilds when the run finishes again.
        $db->table('qa_reports')->where('qa_run_id', $qaRunId)->where('kind', 'final')->delete();

        // Use query builder so NULL timestamps/claim fields are written (Model may skip nulls).
        $db->table('qa_sessions')->where('id', $sessionId)->update([
            'status'             => 'queued',
            'claimed_by_worker'  => null,
            'claimed_at'         => null,
            'started_at'         => null,
            'completed_at'       => null,
            'last_heartbeat_at'  => null,
            'updated_at'         => date('Y-m-d H:i:s'),
        ]);

        $run = $db->table('qa_runs')->where('qa_run_id', $qaRunId)->get()->getRowArray();
        if ($run) {
            $db->table('qa_runs')->where('qa_run_id', $qaRunId)->update([
                'status'       => 'running',
                'completed_at' => null,
                'summary_json' => null,
                'started_at'   => $run['started_at'] ?? date('Y-m-d H:i:s'),
                'updated_at'   => date('Y-m-d H:i:s'),
            ]);
        }

        $db->transComplete();
        if (! $db->transStatus()) {
            throw new \RuntimeException('Failed to re-queue session.', 500);
        }

        $fresh = $this->find($sessionId);
        if (! $fresh) {
            throw new \RuntimeException('Session not found after re-queue.', 500);
        }

        return ['session' => $fresh, 'previous_status' => $status];
    }
}
