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

    public function getSetting(string $key, mixed $default = null): mixed
    {
        $row = $this->where('key', $key)->first();
        if (! $row) {
            return $default;
        }
        $val = $this->decodeValue($row['value_json'] ?? null);
        return $val ?? $default;
    }

    public function setSetting(string $key, mixed $value, ?int $userId = null): void
    {
        $encoded = json_encode($value);
        $row = $this->where('key', $key)->first();
        if ($row) {
            $this->update($row['id'], ['value_json' => $encoded, 'updated_by' => $userId]);
            return;
        }
        $this->insert([
            'key'        => $key,
            'value_json' => $encoded,
            'updated_by' => $userId,
        ]);
    }

    public function all(): array
    {
        $rows = $this->orderBy('key')->findAll();
        $out  = [];
        foreach ($rows as $r) {
            $out[$r['key']] = $this->decodeValue($r['value_json'] ?? null);
        }
        return $out;
    }

    /**
     * Read a setting expected to be a JSON array of strings. Non-string and
     * empty entries are dropped; anything that does not decode to an array
     * falls back to $default untouched.
     *
     * @param string[] $default
     * @return string[]
     */
    public function getStringList(string $key, array $default = []): array
    {
        $value = $this->getSetting($key);
        if (! is_array($value)) {
            return $default;
        }

        $out = [];
        foreach ($value as $item) {
            if (! is_scalar($item)) {
                continue;
            }
            $item = trim((string) $item);
            if ($item !== '') {
                $out[] = $item;
            }
        }
        return $out;
    }

    public function getInt(string $key, int $default): int
    {
        $value = $this->getSetting($key);
        return is_numeric($value) ? (int) $value : $default;
    }

    public function getBool(string $key, bool $default): bool
    {
        $value = $this->getSetting($key);
        if (is_bool($value)) {
            return $value;
        }
        if (is_string($value)) {
            return match ($value) {
                'true', '1'  => true,
                'false', '0' => false,
                default      => $default,
            };
        }
        return $default;
    }

    /** @return mixed Decoded JSON scalar, array, or null. */
    private function decodeValue(mixed $raw): mixed
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        if (is_array($raw) || is_bool($raw) || is_int($raw) || is_float($raw)) {
            return $raw;
        }
        $decoded = json_decode((string) $raw, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            return $raw;
        }

        return $decoded;
    }
}
