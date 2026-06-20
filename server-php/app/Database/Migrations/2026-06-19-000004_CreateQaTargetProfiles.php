<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaTargetProfiles extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                       => ['type' => 'BIGSERIAL'],
            'profile_name'             => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => false],
            'product_name'             => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'environment'              => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false], // sandbox | gh | prod_basic | prod_full
            'base_url'                 => ['type' => 'VARCHAR', 'constraint' => 512, 'null' => false],
            'login_url'                => ['type' => 'VARCHAR', 'constraint' => 512, 'null' => false],
            'username'                 => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => false],
            'allowed_domains'          => ['type' => 'JSONB', 'null' => true],
            'allowed_modules'          => ['type' => 'JSONB', 'null' => true],
            'execution_mode'           => ['type' => 'VARCHAR', 'constraint' => 32, 'default' => 'full'],
            'data_creation_allowed'    => ['type' => 'BOOLEAN', 'default' => true],
            'production_restriction'   => ['type' => 'BOOLEAN', 'default' => true],
            'ip_restriction'           => ['type' => 'JSONB', 'null' => true],
            'status'                   => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'active'],
            'created_by'               => ['type' => 'BIGINT', 'null' => true],
            'updated_by'               => ['type' => 'BIGINT', 'null' => true],
            'created_at'               => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'               => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey(['profile_name']);
        $this->forge->addKey('product_name');
        $this->forge->addKey('environment');
        $this->forge->createTable('qa_target_profiles', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_target_profiles', true);
    }
}
