<?php

namespace App\Models;

use CodeIgniter\Model;

class AuditLogsModel extends Model
{
    protected $table         = 'qa_audit_logs';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'event', 'actor_id', 'actor_email', 'actor_role',
        'qa_run_id', 'session_id',
        'subject_kind', 'subject_id',
        'ip_address', 'user_agent', 'metadata', 'created_at',
    ];

    protected $casts = ['metadata' => 'json-array'];
}
