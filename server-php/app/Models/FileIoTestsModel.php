<?php

namespace App\Models;

use CodeIgniter\Model;

class FileIoTestsModel extends Model
{
    /** @var list<string> */
    public const STATUSES = ['pass', 'fail', 'partial', 'skipped', 'blocked', 'not_applicable'];

    /** @var list<string> */
    public const DIRECTIONS = ['upload', 'download', 'round_trip'];

    protected $table         = 'qa_file_io_tests';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'qa_run_id', 'session_id', 'product_name', 'scenario_key', 'direction',
        'fixture_name', 'upload_ok', 'download_ok', 'compare_status',
        'source_sha256', 'result_sha256', 'source_mime', 'result_mime',
        'source_bytes', 'result_bytes', 'structure_ok', 'structure_notes',
        'rows_expected', 'rows_found', 'mismatched_cells', 'mismatches_json',
        'totals_expected', 'totals_found', 'data_verified', 'verification_notes',
        'artifact_paths_json', 'evidence_json', 'created_at',
    ];

    protected array $casts = [
        'upload_ok'    => 'bool',
        'download_ok'  => 'bool',
        'structure_ok' => 'bool',
    ];

    /** @var list<string> */
    private array $jsonFields = [
        'mismatches_json', 'totals_expected', 'totals_found',
        'artifact_paths_json', 'evidence_json',
    ];

    protected $afterFind    = ['decodeJsonFields'];
    protected $beforeInsert = ['encodeJsonFields'];
    protected $beforeUpdate = ['encodeJsonFields'];

    /**
     * One row per (session, scenario). A re-run of the same session overwrites
     * the previous verdict instead of stacking duplicates in the report.
     *
     * @param array<string, mixed> $row
     */
    public function record(array $row): int
    {
        $existing = $this
            ->where('session_id', (int) $row['session_id'])
            ->where('scenario_key', (string) $row['scenario_key'])
            ->first();

        if ($existing) {
            $this->update((int) $existing['id'], $row);

            return (int) $existing['id'];
        }

        $row['created_at'] ??= date('Y-m-d H:i:s');
        $this->insert($row);

        return (int) $this->getInsertID();
    }

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

    /**
     * Pass rate plus the data-verification roll-up used by the final report.
     *
     * @param list<array<string, mixed>> $rows
     * @return array<string, mixed>
     */
    public static function summarise(array $rows): array
    {
        $counts = array_fill_keys(self::STATUSES, 0);
        $rowsExpected = 0;
        $rowsFound    = 0;
        $mismatched   = 0;
        $verified     = 0;
        $verifiable   = 0;

        foreach ($rows as $row) {
            $status = (string) ($row['compare_status'] ?? '');
            if (isset($counts[$status])) {
                $counts[$status]++;
            }
            $rowsExpected += (int) ($row['rows_expected'] ?? 0);
            $rowsFound    += (int) ($row['rows_found'] ?? 0);
            $mismatched   += (int) ($row['mismatched_cells'] ?? 0);
            if (($row['data_verified'] ?? null) !== null) {
                $verifiable++;
                if ($row['data_verified']) {
                    $verified++;
                }
            }
        }

        $graded = $counts['pass'] + $counts['fail'] + $counts['partial'];

        return [
            'total'          => count($rows),
            'by_status'      => $counts,
            'graded'         => $graded,
            'pass_rate'      => $graded > 0 ? round($counts['pass'] / $graded * 100, 1) : null,
            'data_verified'  => $verified,
            'data_verifiable' => $verifiable,
            'rows_expected'  => $rowsExpected,
            'rows_found'     => $rowsFound,
            'mismatched_cells' => $mismatched,
        ];
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

        if (array_key_exists('data_verified', $row) && $row['data_verified'] !== null) {
            $row['data_verified'] = filter_var($row['data_verified'], FILTER_VALIDATE_BOOL);
        }

        return $row;
    }
}
