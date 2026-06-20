<?php

namespace App\Models;

use CodeIgniter\Model;

class SessionResultsModel extends Model
{
    protected $table         = 'qa_session_results';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'session_id', 'qa_run_id', 'status', 'severity',
        'passed_count', 'failed_count', 'warning_count',
        'result_json', 'screenshot_paths', 'trace_path',
        'console_errors', 'network_errors',
        'suggested_area', 'suggested_prompt',
        'started_at', 'completed_at', 'created_at',
    ];

    protected array $casts = [
        'result_json'      => 'json-array',
        'screenshot_paths' => 'json-array',
        'console_errors'   => 'json-array',
        'network_errors'   => 'json-array',
    ];
}
