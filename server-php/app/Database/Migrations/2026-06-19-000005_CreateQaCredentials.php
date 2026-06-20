<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaCredentials extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                => ['type' => 'BIGSERIAL'],
            'target_profile_id' => ['type' => 'BIGINT', 'null' => false],
            'secret_ciphertext' => ['type' => 'BYTEA', 'null' => false],
            'iv'                => ['type' => 'BYTEA', 'null' => false],
            'auth_tag'          => ['type' => 'BYTEA', 'null' => false],
            'version'           => ['type' => 'INTEGER', 'default' => 1],
            'rotated_at'        => ['type' => 'TIMESTAMP', 'null' => true],
            'created_by'        => ['type' => 'BIGINT', 'null' => true],
            'created_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey('target_profile_id');
        $this->forge->addForeignKey('target_profile_id', 'qa_target_profiles', 'id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_credentials', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_credentials', true);
    }
}
