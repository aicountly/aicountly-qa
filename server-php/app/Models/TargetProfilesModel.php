<?php

namespace App\Models;

use CodeIgniter\Model;
use Config\Environments;

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
        'login_strategy', 'observer_mode', 'read_only', 'allow_safe_demo',
        'extra_config', 'jump_to',
    ];

    /** @var list<string> */
    private array $jsonArrayFields = ['allowed_domains', 'allowed_modules', 'ip_restriction'];

    protected array $casts = [
        'data_creation_allowed'  => 'bool',
        'production_restriction' => 'bool',
        'observer_mode'          => 'bool',
        'read_only'              => 'bool',
        'allow_safe_demo'        => 'bool',
    ];

    protected $afterFind = ['decodeJsonArrayFields'];
    protected $beforeInsert = ['encodeJsonArrayFields'];
    protected $beforeUpdate = ['encodeJsonArrayFields'];

    protected function encodeJsonArrayFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        foreach ([...$this->jsonArrayFields, 'extra_config'] as $field) {
            if (array_key_exists($field, $data['data']) && is_array($data['data'][$field])) {
                $data['data'][$field] = json_encode($data['data'][$field]);
            }
        }

        if (array_key_exists('environment', $data['data'])) {
            $data['data']['environment'] = Environments::normalize((string) $data['data']['environment']);
        }

        return $data;
    }

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

        if (array_key_exists('extra_config', $row)) {
            $decoded = $this->decodeJsonArray($row['extra_config']);
            $row['extra_config'] = $decoded === [] ? null : $decoded;
        }

        if (array_key_exists('environment', $row)) {
            $row['environment'] = Environments::normalize((string) $row['environment']);
            $row['environment_label']    = Environments::label($row['environment']);
            $row['is_production']        = Environments::isProduction($row['environment']);
            $row['environment_observer_only'] = Environments::isObserverOnly($row['environment']);
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

        return $row ? Environments::isProduction((string) ($row['environment'] ?? '')) : false;
    }

    /** Observer-only tiers can never create data or move files, whatever the row says. */
    public function isObserverOnly(int $id): bool
    {
        $row = $this->find($id);

        return $row ? Environments::isObserverOnly((string) ($row['environment'] ?? '')) : false;
    }

    /**
     * Effective permissions for a profile row: the environment tier always wins
     * over the per-profile toggles.
     *
     * @param array<string, mixed> $row
     * @return array{observer_only:bool,read_only:bool,data_creation_allowed:bool,file_actions_allowed:bool,allow_safe_demo:bool}
     */
    public static function capabilities(array $row): array
    {
        $env          = (string) ($row['environment'] ?? '');
        $observerOnly = Environments::isObserverOnly($env);

        return [
            'observer_only'         => $observerOnly || ! empty($row['observer_mode']),
            'read_only'             => $observerOnly || ! empty($row['read_only']),
            'data_creation_allowed' => ! $observerOnly && ! empty($row['data_creation_allowed']),
            'file_actions_allowed'  => ! $observerOnly && ! empty($row['allow_safe_demo']),
            'allow_safe_demo'       => ! $observerOnly && ! empty($row['allow_safe_demo']),
        ];
    }
}
