<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaSessionResults extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                => ['type' => 'BIGSERIAL'],
            'session_id'        => ['type' => 'BIGINT', 'null' => false],
            'qa_run_id'         => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'status'            => ['type' => 'VARCHAR', 'constraint' => 24, 'null' => false], // passed|failed|partial|skipped
            'severity'          => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'low'], // critical|high|medium|low|warning
            'passed_count'      => ['type' => 'INTEGER', 'default' => 0],
            'failed_count'      => ['type' => 'INTEGER', 'default' => 0],
            'warning_count'     => ['type' => 'INTEGER', 'default' => 0],
            'result_json'       => ['type' => 'JSONB', 'null' => false], // tested screens, data entered, steps, expected vs actual
            'screenshot_paths'  => ['type' => 'JSONB', 'null' => true],
            'trace_path'        => ['type' => 'VARCHAR', 'constraint' => 512, 'null' => true],
            'console_errors'    => ['type' => 'JSONB', 'null' => true],
            'network_errors'    => ['type' => 'JSONB', 'null' => true],
            'suggested_area'    => ['type' => 'TEXT', 'null' => true],
            'suggested_prompt'  => ['type' => 'TEXT', 'null' => true],
            'started_at'        => ['type' => 'TIMESTAMP', 'null' => true],
            'completed_at'      => ['type' => 'TIMESTAMP', 'null' => true],
            'created_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addKey('severity');
        $this->forge->createTable('qa_session_results', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_session_results', true);
    }
}
