<?php

namespace App\Models;

use CodeIgniter\Model;

class RunsModel extends Model
{
    protected $table         = 'qa_runs';
    protected $primaryKey    = 'qa_run_id';
    protected $returnType    = 'array';
    protected $useAutoIncrement = false;
    protected $useTimestamps = true;

    protected $allowedFields = [
        'qa_run_id', 'target_profile_id', 'product_name', 'environment',
        'created_by', 'status', 'started_at', 'completed_at', 'summary_json',
    ];

    protected $afterFind = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if (array_key_exists('summary_json', $data['data']) && is_array($data['data']['summary_json'])) {
            $data['data']['summary_json'] = json_encode($data['data']['summary_json']);
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
        if (array_key_exists('summary_json', $row)) {
            $row['summary_json'] = $this->decodeJsonValue($row['summary_json']);
        }

        return $row;
    }

    /** @return array<string, mixed>|null */
    private function decodeJsonValue(mixed $raw): ?array
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
}
