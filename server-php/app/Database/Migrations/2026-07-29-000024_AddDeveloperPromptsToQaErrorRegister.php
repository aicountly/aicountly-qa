<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class AddDeveloperPromptsToQaErrorRegister extends Migration
{
    public function up(): void
    {
        $this->forge->addColumn('qa_error_register', [
            'human_summary'        => ['type' => 'TEXT', 'null' => true, 'after' => 'sample_message'],
            'developer_fix_prompt' => ['type' => 'TEXT', 'null' => true, 'after' => 'human_summary'],
        ]);
    }

    public function down(): void
    {
        $this->forge->dropColumn('qa_error_register', ['human_summary', 'developer_fix_prompt']);
    }
}
