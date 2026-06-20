<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateQaRunSequence extends Migration
{
    public function up(): void
    {
        // Daily-rolling QA run-id sequence: QA-RUN-YYYYMMDD-NNNN
        $this->forge->addField([
            'day_key'    => ['type' => 'VARCHAR', 'constraint' => 8, 'null' => false], // YYYYMMDD
            'last_seq'   => ['type' => 'INTEGER', 'default' => 0],
            'updated_at' => ['type' => 'TIMESTAMP', 'default' => new \CodeIgniter\Database\RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('day_key');
        $this->forge->createTable('qa_run_sequence', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_run_sequence', true);
    }
}
