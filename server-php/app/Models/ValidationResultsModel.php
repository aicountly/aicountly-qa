<?php

namespace App\Models;

use CodeIgniter\Model;

class ValidationResultsModel extends Model
{
    protected $table         = 'qa_validation_results';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'session_id', 'qa_run_id', 'rule_code', 'passed',
        'expected', 'actual', 'diff', 'severity', 'notes', 'created_at',
    ];
}
