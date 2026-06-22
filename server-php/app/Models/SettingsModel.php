<?php

namespace App\Models;

use CodeIgniter\Model;

class SettingsModel extends Model
{
    protected $table         = 'qa_settings';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = ['key', 'value_json', 'description', 'updated_by'];

    protected array $casts = ['value_json' => 'json-array'];

    public function getSetting(string $key, mixed $default = null): mixed
    {
        $row = $this->where('key', $key)->first();
        if (! $row) {
            return $default;
        }
        $val = $row['value_json'] ?? null;
        return $val ?? $default;
    }

    public function setSetting(string $key, mixed $value, ?int $userId = null): void
    {
        $row = $this->where('key', $key)->first();
        if ($row) {
            $this->update($row['id'], ['value_json' => json_encode($value), 'updated_by' => $userId]);
            return;
        }
        $this->insert([
            'key'        => $key,
            'value_json' => json_encode($value),
            'updated_by' => $userId,
        ]);
    }

    public function all(): array
    {
        $rows = $this->orderBy('key')->findAll();
        $out  = [];
        foreach ($rows as $r) {
            $out[$r['key']] = $r['value_json'];
        }
        return $out;
    }
}
