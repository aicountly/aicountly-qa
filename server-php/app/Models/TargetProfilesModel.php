<?php

namespace App\Models;

use CodeIgniter\Model;

class TargetProfilesModel extends Model
{
    protected $table         = 'qa_target_profiles';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;

    protected $allowedFields = [
        'profile_name', 'product_name', 'environment',
        'base_url', 'login_url', 'username',
        'allowed_domains', 'allowed_modules', 'execution_mode',
        'data_creation_allowed', 'production_restriction',
        'ip_restriction', 'status', 'created_by', 'updated_by',
    ];

    /** @var list<string> */
    private array $jsonArrayFields = ['allowed_domains', 'allowed_modules', 'ip_restriction'];

    protected array $casts = [
        'data_creation_allowed'  => 'bool',
        'production_restriction' => 'bool',
    ];

    protected $afterFind = ['decodeJsonArrayFields'];

    protected function decodeJsonArrayFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if ($data['singleton']) {
            $data['data'] = $this->decodeJsonArrayRow($data['data']);

            return $data;
        }

        foreach ($data['data'] as $i => $row) {
            if (is_array($row)) {
                $data['data'][$i] = $this->decodeJsonArrayRow($row);
            }
        }

        return $data;
    }

    private function decodeJsonArrayRow(array $row): array
    {
        foreach ($this->jsonArrayFields as $field) {
            if (array_key_exists($field, $row)) {
                $row[$field] = $this->decodeJsonArray($row[$field]);
            }
        }

        return $row;
    }

    /** @return list<mixed> */
    private function decodeJsonArray(mixed $raw): array
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

    public function isProduction(int $id): bool
    {
        $row = $this->find($id);
        if (! $row) {
            return false;
        }
        return in_array($row['environment'] ?? '', ['prod_basic', 'prod_full'], true);
    }
}
