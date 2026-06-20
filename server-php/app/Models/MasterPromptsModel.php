<?php

namespace App\Models;

use CodeIgniter\Model;

class MasterPromptsModel extends Model
{
    protected $table         = 'qa_master_prompts';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;
    protected $allowedFields = [
        'qa_run_id', 'user_id', 'target_profile_id', 'prompt_text', 'prompt_kind', 'created_at',
    ];
}
