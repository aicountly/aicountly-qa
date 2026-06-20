<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

class CreateQaMasterPrompts extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                => ['type' => 'BIGSERIAL'],
            'qa_run_id'         => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'user_id'           => ['type' => 'BIGINT', 'null' => true],
            'target_profile_id' => ['type' => 'BIGINT', 'null' => false],
            'prompt_text'       => ['type' => 'TEXT', 'null' => false],
            'prompt_kind'       => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'template'], // template|llm|hybrid
            'created_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('target_profile_id', 'qa_target_profiles', 'id', 'RESTRICT', 'CASCADE');
        $this->forge->createTable('qa_master_prompts', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_master_prompts', true);
    }
}
