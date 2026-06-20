<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaRuns extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'qa_run_id'         => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false], // QA-RUN-YYYYMMDD-NNNN
            'target_profile_id' => ['type' => 'BIGINT', 'null' => false],
            'product_name'      => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'environment'       => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'created_by'        => ['type' => 'BIGINT', 'null' => true],
            'status'            => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'pending'], // pending|running|completed|failed|cancelled
            'started_at'        => ['type' => 'TIMESTAMP', 'null' => true],
            'completed_at'      => ['type' => 'TIMESTAMP', 'null' => true],
            'summary_json'      => ['type' => 'JSONB', 'null' => true],
            'created_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('qa_run_id');
        $this->forge->addForeignKey('target_profile_id', 'qa_target_profiles', 'id', 'RESTRICT', 'CASCADE');
        $this->forge->addKey('product_name');
        $this->forge->addKey('status');
        $this->forge->createTable('qa_runs', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_runs', true);
    }
}
