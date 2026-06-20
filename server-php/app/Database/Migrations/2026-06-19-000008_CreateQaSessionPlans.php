<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaSessionPlans extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'              => ['type' => 'BIGSERIAL'],
            'qa_run_id'       => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'master_prompt_id'=> ['type' => 'BIGINT', 'null' => true],
            'plan_json'       => ['type' => 'JSONB', 'null' => false],
            'status'          => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'draft'], // draft|approved|rejected
            'approved_by'     => ['type' => 'BIGINT', 'null' => true],
            'approved_at'     => ['type' => 'TIMESTAMP', 'null' => true],
            'created_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_session_plans', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_session_plans', true);
    }
}
