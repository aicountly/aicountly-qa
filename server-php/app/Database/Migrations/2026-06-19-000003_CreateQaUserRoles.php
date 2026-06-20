<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateQaUserRoles extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'         => ['type' => 'BIGSERIAL'],
            'user_id'    => ['type' => 'BIGINT', 'null' => false],
            'role_id'    => ['type' => 'BIGINT', 'null' => false],
            'created_at' => ['type' => 'TIMESTAMP', 'default' => new \CodeIgniter\Database\RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey(['user_id', 'role_id']);
        $this->forge->addForeignKey('user_id', 'qa_users', 'id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('role_id', 'qa_roles', 'id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_user_roles', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_user_roles', true);
    }
}
