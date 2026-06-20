<?php

namespace App\Models;

use CodeIgniter\Model;

class UserRolesModel extends Model
{
    protected $table         = 'qa_user_roles';
    protected $primaryKey    = 'id';
    protected $returnType    = 'array';
    protected $useTimestamps = false;
    protected $allowedFields = ['user_id', 'role_id', 'created_at'];
}
