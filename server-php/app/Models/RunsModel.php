<?php

namespace App\Models;

use CodeIgniter\Model;

class RunsModel extends Model
{
    protected $table         = 'qa_runs';
    protected $primaryKey    = 'qa_run_id';
    protected $returnType    = 'array';
    protected $useAutoIncrement = false;
    protected $useTimestamps = true;

    protected $allowedFields = [
        'qa_run_id', 'target_profile_id', 'product_name', 'environment',
        'created_by', 'status', 'started_at', 'completed_at', 'summary_json',
    ];

    protected $casts = [
        'summary_json' => 'json-array',
    ];
}
