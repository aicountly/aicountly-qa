<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use CodeIgniter\Database\RawSql;

/**
 * Deterministic file upload/download/round-trip results.
 *
 * QA's flavour of the smoke table: the fidelity columns are the same, but the
 * competitor/AI-scoring columns are replaced by data-verification columns
 * (row counts, key-column mismatches, numeric totals) because QA answers
 * "is the data correct?", not "how does this compare to a competitor?".
 */
class CreateQaFileIoTests extends Migration
{
    public function up(): void
    {
        $this->forge->addField([
            'id'                  => ['type' => 'BIGSERIAL'],
            'qa_run_id'           => ['type' => 'VARCHAR', 'constraint' => 32, 'null' => false],
            'session_id'          => ['type' => 'BIGINT', 'null' => false],
            'product_name'        => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => false],
            'scenario_key'        => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => false],
            // upload | download | round_trip
            'direction'           => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => false],
            'fixture_name'        => ['type' => 'VARCHAR', 'constraint' => 255, 'null' => true],
            'upload_ok'           => ['type' => 'BOOLEAN', 'default' => false],
            'download_ok'         => ['type' => 'BOOLEAN', 'default' => false],
            // pass | fail | partial | skipped | blocked | not_applicable
            'compare_status'      => ['type' => 'VARCHAR', 'constraint' => 16, 'null' => false],
            'source_sha256'       => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'result_sha256'       => ['type' => 'VARCHAR', 'constraint' => 64, 'null' => true],
            'source_mime'         => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'result_mime'         => ['type' => 'VARCHAR', 'constraint' => 128, 'null' => true],
            'source_bytes'        => ['type' => 'BIGINT', 'null' => true],
            'result_bytes'        => ['type' => 'BIGINT', 'null' => true],
            'structure_ok'        => ['type' => 'BOOLEAN', 'default' => false],
            'structure_notes'     => ['type' => 'TEXT', 'null' => true],
            // Data verification — the QA-specific half.
            'rows_expected'       => ['type' => 'INTEGER', 'null' => true],
            'rows_found'          => ['type' => 'INTEGER', 'null' => true],
            'mismatched_cells'    => ['type' => 'INTEGER', 'null' => true],
            'mismatches_json'     => ['type' => 'JSONB', 'null' => true],
            'totals_expected'     => ['type' => 'JSONB', 'null' => true],
            'totals_found'        => ['type' => 'JSONB', 'null' => true],
            'data_verified'       => ['type' => 'BOOLEAN', 'null' => true],
            'verification_notes'  => ['type' => 'TEXT', 'null' => true],
            'artifact_paths_json' => ['type' => 'JSONB', 'null' => true],
            'evidence_json'       => ['type' => 'JSONB', 'null' => true],
            'created_at'          => ['type' => 'TIMESTAMP', 'default' => new RawSql('CURRENT_TIMESTAMP')],
        ]);

        $this->forge->addPrimaryKey('id');
        $this->forge->addKey('qa_run_id');
        $this->forge->addKey('session_id');
        $this->forge->addKey('compare_status');
        $this->forge->addUniqueKey(['session_id', 'scenario_key']);
        $this->forge->addForeignKey('qa_run_id', 'qa_runs', 'qa_run_id', 'CASCADE', 'CASCADE');
        $this->forge->addForeignKey('session_id', 'qa_sessions', 'id', 'CASCADE', 'CASCADE');
        $this->forge->createTable('qa_file_io_tests', true);
    }

    public function down(): void
    {
        $this->forge->dropTable('qa_file_io_tests', true);
    }
}
