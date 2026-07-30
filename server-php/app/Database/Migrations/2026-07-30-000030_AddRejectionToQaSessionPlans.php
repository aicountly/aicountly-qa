<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Rejection columns for qa_session_plans, mirroring the approve trio.
 *
 * `POST /v1/session-plans/{id}/reject` needs somewhere to keep the operator's
 * reason; the portal already renders `rejected_reason` on a rejected plan.
 * Additive and column-guarded, so a partially migrated deploy is safe.
 */
class AddRejectionToQaSessionPlans extends Migration
{
    private const TABLE = 'qa_session_plans';

    public function up(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $existing = array_map('strtolower', $this->db->getFieldNames(self::TABLE));
        $columns  = [
            'rejected_reason' => ['type' => 'TEXT', 'null' => true],
            'rejected_by'     => ['type' => 'BIGINT', 'null' => true],
            'rejected_at'     => ['type' => 'TIMESTAMP', 'null' => true],
        ];

        $add = [];
        foreach ($columns as $name => $definition) {
            if (! in_array($name, $existing, true)) {
                $add[$name] = $definition;
            }
        }

        if ($add !== []) {
            $this->forge->addColumn(self::TABLE, $add);
        }
    }

    public function down(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $existing = array_map('strtolower', $this->db->getFieldNames(self::TABLE));
        foreach (['rejected_reason', 'rejected_by', 'rejected_at'] as $column) {
            if (in_array($column, $existing, true)) {
                $this->forge->dropColumn(self::TABLE, $column);
            }
        }
    }
}
