<?php

namespace App\Models;

use CodeIgniter\Model;

class SessionPlansModel extends Model
{
    protected $table         = 'qa_session_plans';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = [
        'qa_run_id', 'master_prompt_id', 'plan_json', 'status',
        'approved_by', 'approved_at',
    ];

    protected array $casts = [
        'plan_json' => 'json-array',
    ];
}
