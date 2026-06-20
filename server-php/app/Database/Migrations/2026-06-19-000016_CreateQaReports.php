<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaReports extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'             => ['type' => 'BIGSERIAL'],
            'qa_run_id'      => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'session_id'     => ['type' => 'BIGINT', 'null' => true],
            'kind'           => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => false], // session|final
            'product_name'   => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'html_path'      => ['type' => 'VARCHAR', 'constraint' => 1024, 'null' => true],
            'json_path'      => ['type' => 'VARCHAR', 'constraint' => 1024, 'null' => true],
            'generated_at'   => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'SET NULL', 'CASCADE');
        $this->forge->addKey('kind');
        $this->forge->createTable('qa_reports', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_reports', true);
    }
}
