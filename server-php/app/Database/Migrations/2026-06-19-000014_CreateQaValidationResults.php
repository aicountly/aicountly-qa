<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaValidationResults extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'         => ['type' => 'BIGSERIAL'],
            'session_id' => ['type' => 'BIGINT', 'null' => false],
            'qa_run_id'  => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'rule_code'  => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'passed'     => ['type' => 'BOOLEAN', 'default' => false],
            'expected'   => ['type' => 'TEXT', 'null' => true],
            'actual'     => ['type' => 'TEXT', 'null' => true],
            'diff'       => ['type' => 'TEXT', 'null' => true],
            'severity'   => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'low'],
            'notes'      => ['type' => 'TEXT', 'null' => true],
            'created_at' => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addKey('rule_code');
        $this->forge->addKey('passed');
        $this->forge->createTable('qa_validation_results', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_validation_results', true);
    }
}
