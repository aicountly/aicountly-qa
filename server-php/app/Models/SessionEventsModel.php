<?php

namespace App\Models;

use CodeIgniter\Model;

class SessionEventsModel extends Model
{
    protected $table         = 'qa_session_events';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;
    protected $allowedFields = [
        'session_id', 'qa_run_id', 'event_type', 'message',
        'step_key', 'step_index', 'total_steps', 'metadata', 'created_at',
    ];

    protected $afterFind  = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if (array_key_exists('metadata', $data['data']) && is_array($data['data']['metadata'])) {
            $data['data']['metadata'] = json_encode($data['data']['metadata']);
        }

        return $data;
    }

    protected function decodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        $decode = static function (array $row): array {
            if (array_key_exists('metadata', $row) && is_string($row['metadata'])) {
                $decoded = json_decode($row['metadata'], true);
                $row['metadata'] = json_last_error() === JSON_ERROR_NONE ? $decoded : null;
            }

            return $row;
        };

        if (! empty($data['singleton'])) {
            if (is_array($data['data'])) {
                $data['data'] = $decode($data['data']);
            }

            return $data;
        }

        foreach ($data['data'] as $i => $row) {
            if (is_array($row)) {
                $data['data'][$i] = $decode($row);
            }
        }

        return $data;
    }

    public function record(
        int $sessionId,
        string $qaRunId,
        string $eventType,
        string $message,
        array $extra = []
    ): void {
        $this->insert([
            'session_id'  => $sessionId,
            'qa_run_id'   => $qaRunId,
            'event_type'  => $eventType,
            'message'     => $message,
            'step_key'    => $extra['step_key'] ?? null,
            'step_index'  => isset($extra['step_index']) ? (int) $extra['step_index'] : null,
            'total_steps' => isset($extra['total_steps']) ? (int) $extra['total_steps'] : null,
            'metadata'    => $extra['metadata'] ?? null,
            'created_at'  => gmdate('Y-m-d H:i:s'),
        ]);
    }
}
