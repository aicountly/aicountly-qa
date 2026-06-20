<?php

namespace App\Models;

use CodeIgniter\Model;

class CredentialsModel extends Model
{
    protected $table         = 'qa_credentials';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $allowedFields = [
        'target_profile_id', 'secret_ciphertext', 'iv', 'auth_tag', 'version',
        'rotated_at', 'created_by',
    ];

    public function findByProfile(int $targetProfileId): ?array
    {
        return $this->where('target_profile_id', $targetProfileId)->first();
    }
}
