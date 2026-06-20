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

    protected array $casts = [
        'scope_json' => 'json-array',
    ];

    /**
     * Atomically claim the next queued session for a worker.
     * Uses Postgres SKIP LOCKED so multiple workers (if ever introduced) never grab
     * the same row, even though in MVP only one worker should run at a time.
     */
    public function claimNext(string $workerId): ?array
    {
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

        return $row ?: null;
    }
}
