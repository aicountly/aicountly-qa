<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

/**
 * Ported concept from smoke's smoke_feature_gaps: heuristic + AI-refined
 * competitor feature-gap findings. QA references sessions/runs the same way
 * qa_file_io_tests does (qa_run_id varchar FK, session_id int FK) instead of
 * smoke's job_id.
 */
class CreateQaFeatureGaps extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                => ['type' => 'BIGSERIAL'],
            'qa_run_id'         => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'session_id'        => ['type' => 'BIGINT', 'null' => false],
            'product_name'      => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'expected_feature'  => ['type' => 'VARCHAR', 'constraint' => 512, 'null' => false],
            'observed'          => ['type' => 'BOOLEAN', 'default' => false],
            'severity'          => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'medium'],
            'confidence'        => ['type' => 'VARCHAR', 'constraint' => 16, 'default' => 'low'],
            'recommendation'    => ['type' => 'TEXT', 'null' => true],
            'sources_json'      => ['type' => 'JSONB', 'null' => true],
            'evidence_json'     => ['type' => 'JSONB', 'null' => true],
            'created_at'        => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addKey('qa_run_id');
        $this->forge->addKey('session_id');
        $this->forge->addKey('product_name');
        $this->forge->addKey('observed');
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_feature_gaps', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_feature_gaps', true);
    }
}
