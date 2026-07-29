<?php

namespace App\Models;

use CodeIgniter\Model;

class DecisionMemoryModel extends Model
{
    protected $table         = 'qa_decision_memory';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = [
        'product_name', 'environment', 'situation_key',
        'selected_option', 'payload_json', 'remembered_by',
    ];
    protected $afterFind = ['decodePayload'];
    protected $beforeInsert = ['encodePayload'];
    protected $beforeUpdate = ['encodePayload'];

    protected function encodePayload(array $data): array
    {
        if (isset($data['data']['payload_json']) && is_array($data['data']['payload_json'])) {
            $data['data']['payload_json'] = json_encode($data['data']['payload_json']);
        }

        return $data;
    }

    protected function decodePayload(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }
        $decode = static function (array $row): array {
            if (isset($row['payload_json']) && is_string($row['payload_json'])) {
                $value = json_decode($row['payload_json'], true);
                $row['payload_json'] = json_last_error() === JSON_ERROR_NONE ? $value : null;
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

    public function remember(array $key, string $selectedOption, ?array $payload, ?int $userId): array
    {
        $existing = $this->where($key)->first();
        $row = $key + [
            'selected_option' => $selectedOption,
            'payload_json'    => $payload,
            'remembered_by'   => $userId,
        ];
        if ($existing) {
            $this->update($existing['id'], $row);
            return $this->find($existing['id']);
        }
        $id = $this->insert($row, true);

        return $this->find($id);
    }
}
