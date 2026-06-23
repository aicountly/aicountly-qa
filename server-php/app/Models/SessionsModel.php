<?php

namespace App\Models;

use CodeIgniter\Model;

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
        $this->requeueStaleClaims(10);

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

    /** Re-queue sessions left in claimed state after a worker crash. */
    public function requeueStaleClaims(int $minutes = 10): void
    {
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
}
