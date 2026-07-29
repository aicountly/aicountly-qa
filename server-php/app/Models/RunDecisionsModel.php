<?php

namespace App\Models;

use CodeIgniter\Model;

class RunDecisionsModel extends Model
{
    protected $table         = 'qa_run_decisions';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = [
        'qa_run_id', 'session_id', 'situation_key', 'question',
        'options_json', 'context_json', 'screenshot_path', 'status',
        'selected_option', 'free_text', 'answered_by', 'answered_at',
        'remember', 'source',
    ];
    protected array $casts = ['remember' => 'bool'];
    protected $afterFind = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }
        foreach (['options_json', 'context_json'] as $field) {
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
        $decode = static function (array $row): array {
            foreach (['options_json', 'context_json'] as $field) {
                if (isset($row[$field]) && is_string($row[$field])) {
                    $value = json_decode($row[$field], true);
                    $row[$field] = json_last_error() === JSON_ERROR_NONE ? $value : null;
                }
            }

            return $row;
        };
        if (! empty($data['singleton'])) {
            $data['data'] = is_array($data['data']) ? $decode($data['data']) : $data['data'];
            return $data;
        }
        foreach ($data['data'] as $i => $row) {
            if (is_array($row)) {
                $data['data'][$i] = $decode($row);
            }
        }

        return $data;
    }
}
