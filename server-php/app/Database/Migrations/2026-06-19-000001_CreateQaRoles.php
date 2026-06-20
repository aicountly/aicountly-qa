<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateQaRoles extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'          => ['type' => 'BIGSERIAL'],
            'code'        => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'name'        => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => false],
            'description' => ['type' => 'TEXT', 'null' => true],
            'created_at'  => ['type' => 'TIMESTAMP', 'default' => new \CodeIgniter\Database\RawSql('CURRENT_TIMESTAMP')],
            'updated_at'  => ['type' => 'TIMESTAMP', 'default' => new \CodeIgniter\Database\RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey('code');
        $this->forge->createTable('qa_roles', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_roles', true);
    }
}
