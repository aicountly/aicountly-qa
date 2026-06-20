<?php

namespace App\Models;

use CodeIgniter\Model;

class TargetProfilesModel extends Model
{
    protected $table         = 'qa_target_profiles';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;

    protected $allowedFields = [
        'profile_name', 'product_name', 'environment',
        'base_url', 'login_url', 'username',
        'allowed_domains', 'allowed_modules', 'execution_mode',
        'data_creation_allowed', 'production_restriction',
        'ip_restriction', 'status', 'created_by', 'updated_by',
    ];

    protected array $casts = [
        'allowed_domains'        => 'json-array',
        'allowed_modules'        => 'json-array',
        'ip_restriction'         => 'json-array',
        'data_creation_allowed'  => 'bool',
        'production_restriction' => 'bool',
    ];

    public function isProduction(int $id): bool
    {
        $row = $this->find($id);
        if (! $row) {
            return false;
        }
        return in_array($row['environment'] ?? '', ['prod_basic', 'prod_full'], true);
    }
}
