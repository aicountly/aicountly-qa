<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaReportFiles extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'         => ['type' => 'BIGSERIAL'],
            'report_id'  => ['type' => 'BIGINT', 'null' => true],
            'session_id' => ['type' => 'BIGINT', 'null' => true],
            'qa_run_id'  => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'kind'       => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
                // screenshot|trace|console|network|html|json|raw_text
            'path'       => ['type' => 'VARCHAR', 'constraint' => 1024, 'null' => false],
            'size_bytes' => ['type' => 'BIGINT', 'default' => 0],
            'mime_type'  => ['type' => 'VARCHAR', 'constraint' => 96, 'null' => true],
            'created_at' => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('report_id', 'qa_reports', 'id', 'SET NULL', 'CASCADE');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'SET NULL', 'CASCADE');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addKey('kind');
        $this->forge->createTable('qa_report_files', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_report_files', true);
    }
}
