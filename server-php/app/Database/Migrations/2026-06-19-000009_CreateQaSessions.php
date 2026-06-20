<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaSessions extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                => ['type' => 'BIGSERIAL'],
            'qa_run_id'         => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'session_plan_id'   => ['type' => 'BIGINT', 'null' => true],
            'name'              => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => false],
            'template_code'     => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'module'            => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'sub_module'        => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'order_index'       => ['type' => 'INTEGER', 'default' => 0],
            'scope_json'        => ['type' => 'JSONB', 'null' => true],
            'status'            => ['type' => 'VARCHAR', 'constraint' => 24, 'default' => 'queued'],
                // queued|claimed|running|completed|failed|skipped|blocked_by_safe_guard
            'claimed_by_worker' => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'claimed_at'        => ['type' => 'TIMESTAMP', 'null' => true],
            'started_at'        => ['type' => 'TIMESTAMP', 'null' => true],
            'completed_at'      => ['type' => 'TIMESTAMP', 'null' => true],
            'last_heartbeat_at' => ['type' => 'TIMESTAMP', 'null' => true],
            'created_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('session_plan_id', 'qa_session_plans', 'id', 'SET NULL', 'CASCADE');
        $this->forge->addKey('status');
        $this->forge->addKey(['qa_run_id', 'order_index']);
        $this->forge->createTable('qa_sessions', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_sessions', true);
    }
}
