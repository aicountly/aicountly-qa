<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaRunDecisions extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'              => ['type' => 'BIGSERIAL'],
            'qa_run_id'       => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'session_id'      => ['type' => 'BIGINT', 'null' => false],
            'situation_key'   => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => false],
            'question'        => ['type' => 'TEXT', 'null' => false],
            'options_json'    => ['type' => 'JSONB', 'null' => false],
            'context_json'    => ['type' => 'JSONB', 'null' => true],
            'screenshot_path' => ['type' => 'TEXT', 'null' => true],
            'status'          => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'pending'],
            'selected_option' => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'free_text'       => ['type' => 'TEXT', 'null' => true],
            'answered_by'     => ['type' => 'BIGINT', 'null' => true],
            'answered_at'     => ['type' => 'TIMESTAMP', 'null' => true],
            'remember'        => ['type' => 'BOOLEAN', 'default' => false],
            'source'          => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'human'],
            'created_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addKey(['qa_run_id', 'status']);
        $this->forge->addKey(['session_id', 'status']);
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('answered_by', 'qa_users', 'id', 'SET NULL', 'CASCADE');
        $this->forge->createTable('qa_run_decisions', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_run_decisions', true);
    }
}
