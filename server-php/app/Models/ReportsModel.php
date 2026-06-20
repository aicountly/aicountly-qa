<?php

namespace App\Models;

use CodeIgniter\Model;

class ReportsModel extends Model
{
    protected $table         = 'qa_reports';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'qa_run_id', 'session_id', 'kind', 'product_name',
        'html_path', 'json_path', 'generated_at',
    ];
}
