<?php

namespace App\Models;

use CodeIgniter\Model;

class CredentialsModel extends Model
{
    protected $table         = 'qa_credentials';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = [
        'target_profile_id', 'secret_ciphertext', 'iv', 'auth_tag', 'version',
        'rotated_at', 'created_by',
    ];

    /** @var list<string> */
    private array $byteaFields = ['secret_ciphertext', 'iv', 'auth_tag'];

    protected $beforeInsert = ['encodeByteaFields'];
    protected $beforeUpdate = ['encodeByteaFields'];
    protected $afterFind    = ['decodeByteaFields'];

    public function findByProfile(int $targetProfileId): ?array
    {
        return $this->where('target_profile_id', $targetProfileId)->first();
    }

    /**
     * PostgreSQL BYTEA cannot be passed as raw binary through CI query binds
     * (pg_escape_literal fails on non-UTF-8). Store as hex format \x....
     */
    protected function encodeByteaFields(array $data): array
    {
        if (! isset($data['data']) || ! is_array($data['data'])) {
            return $data;
        }

        foreach ($this->byteaFields as $field) {
            if (! array_key_exists($field, $data['data']) || ! is_string($data['data'][$field])) {
                continue;
            }
            $data['data'][$field] = $this->toPgByteaHex($data['data'][$field]);
        }

        return $data;
    }

    protected function decodeByteaFields(array $data): array
    {
        if (! isset($data['data'])) {
            return $data;
        }

        if (! empty($data['singleton'])) {
            if (is_array($data['data'])) {
                $data['data'] = $this->decodeByteaRow($data['data']);
            }

            return $data;
        }

        foreach ($data['data'] as $i => $row) {
            if (is_array($row)) {
                $data['data'][$i] = $this->decodeByteaRow($row);
            }
        }

        return $data;
    }

    private function decodeByteaRow(array $row): array
    {
        foreach ($this->byteaFields as $field) {
            if (array_key_exists($field, $row) && is_string($row[$field])) {
                $row[$field] = $this->fromPgBytea($row[$field]);
            }
        }

        return $row;
    }

    private function toPgByteaHex(string $binary): string
    {
        // Already hex-encoded for PG — leave as-is (avoid double-encoding).
        if (str_starts_with($binary, '\x')) {
            $hex = substr($binary, 2);
            if ($hex !== '' && ctype_xdigit($hex) && (strlen($hex) % 2) === 0) {
                return $binary;
            }
        }

        return '\x' . bin2hex($binary);
    }

    private function fromPgBytea(string $value): string
    {
        if ($value === '') {
            return $value;
        }

        // Default PostgreSQL bytea_output=hex → "\xdeadbeef"
        if (str_starts_with($value, '\x')) {
            $hex = substr($value, 2);
            if ($hex !== '' && ctype_xdigit($hex) && (strlen($hex) % 2) === 0) {
                $bin = hex2bin($hex);

                return $bin === false ? $value : $bin;
            }
        }

        // Escape-format bytea from older drivers / settings
        if (function_exists('pg_unescape_bytea')) {
            $unescaped = @pg_unescape_bytea($value);
            if (is_string($unescaped) && $unescaped !== '') {
                return $unescaped;
            }
        }

        // Already raw binary
        return $value;
    }
}
