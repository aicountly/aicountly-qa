<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use Config\Environments;

/**
 * Bring qa_target_profiles up to smoke parity.
 *
 * `data_creation_allowed`, `execution_mode` and `production_restriction` already
 * exist; this adds the remaining knobs the five-tier model needs.
 */
class AddSafetyKnobsToQaTargetProfiles extends Migration
{
    private const TABLE = 'qa_target_profiles';

    public function up(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $existing = array_map('strtolower', $this->db->getFieldNames(self::TABLE));
        $add      = [];

        $columns = [
            'login_strategy'  => ['type' => 'VARCHAR', 'constraint' => 64, 'default' => 'standard'],
            'observer_mode'   => ['type' => 'BOOLEAN', 'default' => false],
            'read_only'       => ['type' => 'BOOLEAN', 'default' => false],
            'allow_safe_demo' => ['type' => 'BOOLEAN', 'default' => false],
            'extra_config'    => ['type' => 'JSONB', 'null' => true],
            // Product-scoped override for the my.aicountly.com "Jump To" dropdown.
            'jump_to'         => ['type' => 'VARCHAR', 'constraint' => 191, 'null' => true],
        ];

        foreach ($columns as $name => $definition) {
            if (! in_array($name, $existing, true)) {
                $add[$name] = $definition;
            }
        }

        if ($add !== []) {
            $this->forge->addColumn(self::TABLE, $add);
        }

        // Observer-only tiers are read-only by contract, whatever the row says.
        $observerOnly = array_values(array_filter(
            Environments::ALL,
            static fn (string $env): bool => Environments::isObserverOnly($env)
        ));

        $this->db->table(self::TABLE)
            ->whereIn('environment', $observerOnly)
            ->update([
                'observer_mode'          => true,
                'read_only'              => true,
                'production_restriction' => true,
                'allow_safe_demo'        => false,
                'data_creation_allowed'  => false,
            ]);

        // Non-observer rows keep synthetic uploads opt-in but usable by default.
        $this->db->table(self::TABLE)
            ->whereNotIn('environment', $observerOnly)
            ->update(['allow_safe_demo' => true]);
    }

    public function down(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $existing = array_map('strtolower', $this->db->getFieldNames(self::TABLE));
        foreach (['login_strategy', 'observer_mode', 'read_only', 'allow_safe_demo', 'extra_config', 'jump_to'] as $column) {
            if (in_array($column, $existing, true)) {
                $this->forge->dropColumn(self::TABLE, $column);
            }
        }
    }
}
