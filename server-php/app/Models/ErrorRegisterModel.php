<?php

namespace App\Models;

use CodeIgniter\Model;

class ErrorRegisterModel extends Model
{
    protected $table         = 'qa_error_register';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;

    protected $allowedFields = [
        'signature', 'title', 'severity', 'product_name', 'module',
        'first_seen_run_id', 'last_seen_run_id', 'last_session_id',
        'first_seen_at', 'last_seen_at', 'count',
        'sample_message', 'suggested_developer_area', 'status',
    ];

    public function upsertSignature(array $row): int
    {
        $existing = $this->where('signature', $row['signature'])->first();
        $now = date('Y-m-d H:i:s');

        if ($existing) {
            $this->update($existing['id'], [
                'last_seen_run_id' => $row['last_seen_run_id'] ?? $existing['last_seen_run_id'],
                'last_session_id'  => $row['last_session_id']  ?? $existing['last_session_id'],
                'last_seen_at'     => $now,
                'count'            => ((int) $existing['count']) + 1,
                'severity'         => $row['severity'] ?? $existing['severity'],
            ]);
            return (int) $existing['id'];
        }

        $row['first_seen_run_id'] = $row['first_seen_run_id'] ?? ($row['last_seen_run_id'] ?? null);
        $row['first_seen_at']     = $now;
        $row['last_seen_at']      = $now;
        $row['count']             = 1;
        $row['status']            = $row['status'] ?? 'open';

        $this->insert($row);
        return (int) $this->getInsertID();
    }
}
