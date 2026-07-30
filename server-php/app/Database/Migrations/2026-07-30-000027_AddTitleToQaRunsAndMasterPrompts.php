<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * The New QA Run form submits a human title alongside the master prompt.
 * It is stored on both rows: on the prompt because that is what the operator
 * typed, and on the run because every list/report screen shows the run.
 */
class AddTitleToQaRunsAndMasterPrompts extends Migration
{
    public function up(): void
    {
        $this->addTitle('qa_master_prompts');
        $this->addTitle('qa_runs');

        if ($this->db->tableExists('qa_runs') && $this->db->tableExists('qa_master_prompts')) {
            $this->db->query(
                "UPDATE qa_runs r
                 SET title = sub.title
                 FROM (
                     SELECT DISTINCT ON (qa_run_id) qa_run_id, LEFT(prompt_text, 191) AS title
                     FROM qa_master_prompts
                     ORDER BY qa_run_id, id ASC
                 ) sub
                 WHERE r.qa_run_id = sub.qa_run_id AND r.title IS NULL"
            );
        }
    }

    public function down(): void
    {
        foreach (['qa_master_prompts', 'qa_runs'] as $table) {
            if ($this->db->tableExists($table)
                && in_array('title', array_map('strtolower', $this->db->getFieldNames($table)), true)) {
                $this->forge->dropColumn($table, 'title');
            }
        }
    }

    private function addTitle(string $table): void
    {
        if (! $this->db->tableExists($table)) {
            return;
        }
        if (in_array('title', array_map('strtolower', $this->db->getFieldNames($table)), true)) {
            return;
        }

        $this->forge->addColumn($table, [
            'title' => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => true],
        ]);
    }
}
