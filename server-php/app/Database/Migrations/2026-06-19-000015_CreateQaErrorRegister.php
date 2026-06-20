<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaErrorRegister extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                       => ['type' => 'BIGSERIAL'],
            'signature'                => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => false],
            'title'                    => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => false],
            'severity'                 => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'medium'],
            'product_name'             => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'module'                   => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'first_seen_run_id'        => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => true],
            'last_seen_run_id'         => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => true],
            'last_session_id'          => ['type' => 'BIGINT', 'null' => true],
            'first_seen_at'            => ['type' => 'TIMESTAMP', 'null' => true],
            'last_seen_at'             => ['type' => 'TIMESTAMP', 'null' => true],
            'count'                    => ['type' => 'INTEGER', 'default' => 1],
            'sample_message'           => ['type' => 'TEXT', 'null' => true],
            'suggested_developer_area' => ['type' => 'TEXT', 'null' => true],
            'status'                   => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'open'],
            'created_at'               => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'               => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey('signature');
        $this->forge->addKey('severity');
        $this->forge->addKey(['product_name', 'module']);
        $this->forge->createTable('qa_error_register', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_error_register', true);
    }
}
