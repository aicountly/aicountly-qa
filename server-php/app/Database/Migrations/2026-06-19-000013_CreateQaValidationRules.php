<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaValidationRules extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'              => ['type' => 'BIGSERIAL'],
            'rule_code'       => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'rule_kind'       => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => false], // accounting|report|ui|workflow
            'product_name'    => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'title'           => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => false],
            'description'     => ['type' => 'TEXT', 'null' => true],
            'expression_json' => ['type' => 'JSONB', 'null' => false],
            'severity_on_fail'=> ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'high'],
            'is_active'       => ['type' => 'BOOLEAN', 'default' => true],
            'created_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
            'updated_at'      => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addUniqueKey('rule_code');
        $this->forge->addKey('rule_kind');
        $this->forge->createTable('qa_validation_rules', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_validation_rules', true);
    }
}
