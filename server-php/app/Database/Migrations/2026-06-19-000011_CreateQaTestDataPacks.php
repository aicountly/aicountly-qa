<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaTestDataPacks extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'            => ['type' => 'BIGSERIAL'],
            'product_name'  => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'module'        => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => false],
            'pack_name'     => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => false],
            'description'   => ['type' => 'TEXT', 'null' => true],
            'data_json'     => ['type' => 'JSONB', 'null' => false],
            'version'       => ['type' => 'INTEGER', 'default' => 1],
            'is_active'     => ['type' => 'BOOLEAN', 'default' => true],
            'created_by'    => ['type' => 'BIGINT', 'null' => true],
            'created_at'    => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'    => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey(['product_name', 'pack_name', 'version']);
        $this->forge->addKey(['product_name', 'module']);
        $this->forge->createTable('qa_test_data_packs', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_test_data_packs', true);
    }
}
