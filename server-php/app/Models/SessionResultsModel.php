<?php

namespace App\Models;

use CodeIgniter\Model;

class SessionResultsModel extends Model
{
    protected $table         = 'qa_session_results';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'session_id', 'qa_run_id', 'status', 'severity',
        'passed_count', 'failed_count', 'warning_count',
        'result_json', 'screenshot_paths', 'trace_path',
        'console_errors', 'network_errors',
        'suggested_area', 'suggested_prompt',
        'started_at', 'completed_at', 'created_at',
    ];

    protected $afterFind = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        foreach (['result_json', 'screenshot_paths', 'console_errors', 'network_errors'] as $field) {
            if (array_key_exists($field, $data['data']) && is_array($data['data'][$field])) {
                $data['data'][$field] = json_encode($data['data'][$field]);
            }
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
            $data['data'][$i] = $this->decodeJsonRow($row);
        }

        return $data;
    }

    /** @param array<string, mixed> $row */
    private function decodeJsonRow(array $row): array
    {
        foreach (['result_json', 'screenshot_paths', 'console_errors', 'network_errors'] as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = $this->decodeJsonValue($row[$field]);
            }
        }

        return $row;
    }

    private function decodeJsonValue(mixed $value): mixed
    {
        for ($i = 0; $i < 3; $i++) {
            if ($value === null) {
                return null;
            }
            if (is_array($value)) {
                return $value;
            }
            if (! is_string($value)) {
                break;
            }
            if ($value === '') {
                return null;
            }

            $decoded = json_decode($value, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                break;
            }

            $value = $decoded;
        }

        return is_array($value) ? $value : null;
    }
}
