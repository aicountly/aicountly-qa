<?php

namespace App\Models;

use CodeIgniter\Model;

class UsersModel extends Model
{
    protected $table         = 'qa_users';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = true;
    protected $dateFormat    = 'datetime';
    protected $createdField  = 'created_at';
    protected $updatedField  = 'updated_at';

    protected $allowedFields = [
        'email', 'name', 'password_hash', 'status',
        'last_login_at', 'last_login_ip', 'mfa_enabled', 'mfa_secret', 'failed_attempts',
    ];

    public function findByEmail(string $email): ?array
    {
        return $this->where('email', $email)->first();
    }

    public function roleCodes(int $userId): array
    {
        $rows = $this->db->table('qa_user_roles ur')
            ->select('r.code')
            ->join('qa_roles r', 'r.id = ur.role_id')
            ->where('ur.user_id', $userId)
            ->get()->getResultArray();

        return array_values(array_map(fn ($r) => $r['code'], $rows));
    }
}
