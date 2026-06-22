<?php

namespace App\Models;

use CodeIgniter\Model;

class SessionPlansModel extends Model
{
    protected $table         = 'qa_session_plans';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = [
        'qa_run_id', 'master_prompt_id', 'plan_json', 'status',
        'approved_by', 'approved_at',
    ];

    protected $afterFind = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if (array_key_exists('plan_json', $data['data']) && is_array($data['data']['plan_json'])) {
            $data['data']['plan_json'] = json_encode($data['data']['plan_json']);
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
        if (array_key_exists('plan_json', $row)) {
            $row['plan_json'] = $this->decodeJsonValue($row['plan_json']);
        }

        return $row;
    }

    /** @return array<string, mixed> */
    private function decodeJsonValue(mixed $raw): array
    {
        $value = $raw;

        for ($i = 0; $i < 2; $i++) {
            if (is_array($value)) {
                return $value;
            }
            if ($value === null || $value === '') {
                return [];
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

        return is_array($value) ? $value : [];
    }
}
