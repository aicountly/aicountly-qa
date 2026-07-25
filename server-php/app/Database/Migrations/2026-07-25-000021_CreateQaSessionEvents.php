<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaSessionEvents extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'          => ['type' => 'BIGSERIAL'],
            'session_id'  => ['type' => 'BIGINT', 'null' => false],
            'qa_run_id'   => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'event_type'  => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'message'     => ['type' => 'TEXT', 'null' => false],
            'step_key'    => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'step_index'  => ['type' => 'INTEGER', 'null' => true],
            'total_steps' => ['type' => 'INTEGER', 'null' => true],
            'metadata'    => ['type' => 'JSONB', 'null' => true],
            'created_at'  => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addKey('session_id');
        $this->forge->addKey('qa_run_id');
        $this->forge->addKey('created_at');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_session_events', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_session_events', true);
    }
}
