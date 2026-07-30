<?php

namespace App\Models;

use CodeIgniter\Model;

class FeatureGapsModel extends Model
{
    protected $table         = 'qa_feature_gaps';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'qa_run_id', 'session_id', 'product_name', 'expected_feature',
        'observed', 'severity', 'confidence', 'recommendation',
        'sources_json', 'evidence_json', 'created_at',
    ];

    protected array $casts = [
        'observed' => 'bool',
    ];

    /** @var list<string> */
    private array $jsonFields = ['sources_json', 'evidence_json'];

    protected $afterFind    = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    /** @return list<array<string, mixed>> */
    public function forRun(string $qaRunId): array
    {
        return $this->where('qa_run_id', $qaRunId)
            ->orderBy('session_id', 'ASC')
            ->orderBy('id', 'ASC')
            ->findAll();
    }

    /** @return list<array<string, mixed>> */
    public function forSession(int $sessionId): array
    {
        return $this->where('session_id', $sessionId)->orderBy('id', 'ASC')->findAll();
    }

    protected function encodeJsonFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        foreach ($this->jsonFields as $field) {
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

        if (! empty($data['singleton'])) {
            $data['data'] = is_array($data['data']) ? $this->decodeRow($data['data']) : $data['data'];

            return $data;
        }

        foreach ($data['data'] as $i => $row) {
            if (is_array($row)) {
                $data['data'][$i] = $this->decodeRow($row);
            }
        }

        return $data;
    }

    /** @param array<string, mixed> $row */
    private function decodeRow(array $row): array
    {
        foreach ($this->jsonFields as $field) {
            if (! array_key_exists($field, $row)) {
                continue;
            }
            $value = $row[$field];
            if (is_string($value) && $value !== '') {
                $decoded = json_decode($value, true);
                $value   = json_last_error() === JSON_ERROR_NONE ? $decoded : null;
            }
            $row[$field] = is_array($value) ? $value : null;
        }

        return $row;
    }
}
