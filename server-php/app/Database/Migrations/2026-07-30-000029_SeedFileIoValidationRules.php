<?php

namespace App\Database\Migrations;

use App\Services\FileIoRuleCatalog;
use CodeIgniter\Database\Migration;

/**
 * Existing deploys are already seeded, so the product-agnostic file I/O rules
 * are inserted by migration rather than by re-running ValidationRulesSeeder.
 */
class SeedFileIoValidationRules extends Migration
{
    private const TABLE = 'qa_validation_rules';

    public function up(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $now = date('Y-m-d H:i:s');
        foreach (FileIoRuleCatalog::rules() as $rule) {
            $exists = $this->db->table(self::TABLE)
                ->where('rule_code', $rule['rule_code'])
                ->countAllResults();
            if ($exists > 0) {
                continue;
            }

            $this->db->table(self::TABLE)->insert($rule + [
                'is_active'  => true,
                'created_at' => $now,
                'updated_at' => $now,
            ]);
        }
    }

    public function down(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $this->db->table(self::TABLE)
            ->whereIn('rule_code', FileIoRuleCatalog::codes())
            ->delete();
    }
}
