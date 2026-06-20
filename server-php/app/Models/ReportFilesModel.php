<?php

namespace App\Models;

use CodeIgniter\Model;

class ReportFilesModel extends Model
{
    protected $table         = 'qa_report_files';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;

    protected $allowedFields = [
        'report_id', 'session_id', 'qa_run_id', 'kind',
        'path', 'size_bytes', 'mime_type', 'created_at',
    ];
}
