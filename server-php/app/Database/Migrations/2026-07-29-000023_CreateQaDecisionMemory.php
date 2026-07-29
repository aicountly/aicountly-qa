<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaDecisionMemory extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'              => ['type' => 'BIGSERIAL'],
            'product_name'    => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'environment'     => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'situation_key'   => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => false],
            'selected_option' => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => false],
            'payload_json'    => ['type' => 'JSONB', 'null' => true],
            'remembered_by'   => ['type' => 'BIGINT', 'null' => true],
            'created_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey(['product_name', 'environment', 'situation_key']);
        $this->forge->addForeignKey('remembered_by', 'qa_users', 'id', 'SET NULL', 'CASCADE');
        $this->forge->createTable('qa_decision_memory', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_decision_memory', true);
    }
}
