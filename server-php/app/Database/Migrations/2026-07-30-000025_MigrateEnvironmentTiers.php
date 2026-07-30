<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;
use Config\Environments;

/**
 * Adopt the five-tier environment model shared with the smoke portal.
 *
 *   gh          -> gh_staging
 *   prod_basic  -> production_readonly
 *   prod_full   -> production_full_access
 *   sandbox     -> sandbox (unchanged)
 *
 * `production_restricted` has no legacy equivalent; operators opt into it by
 * editing a target profile.
 *
 * The decision-memory unique key is (product_name, environment, situation_key),
 * so renaming values there can collide when both a legacy and a canonical row
 * already exist. Legacy duplicates are dropped in favour of the newer row.
 */
class MigrateEnvironmentTiers extends Migration
{
    /** @var array<string, string> */
    private const TABLES = [
        'qa_target_profiles' => 'environment',
        'qa_runs'            => 'environment',
        'qa_decision_memory' => 'environment',
    ];

    public function up(): void
    {
        $this->dropEnvironmentChecks();

        foreach (self::TABLES as $table => $column) {
            if (! $this->db->tableExists($table)) {
                continue;
            }

            if ($table === 'qa_decision_memory') {
                $this->dedupeDecisionMemory();
            }

            foreach (Environments::LEGACY_MAP as $legacy => $canonical) {
                $this->db->table($table)
                    ->where($column, $legacy)
                    ->update([$column => $canonical]);
            }
        }

        if ($this->db->tableExists('qa_target_profiles')) {
            $this->db->query(
                "ALTER TABLE qa_target_profiles ALTER COLUMN environment SET DEFAULT '"
                . Environments::DEFAULT . "'"
            );
        }
    }

    public function down(): void
    {
        $reverse = array_flip(Environments::LEGACY_MAP);

        foreach (self::TABLES as $table => $column) {
            if (! $this->db->tableExists($table)) {
                continue;
            }
            foreach ($reverse as $canonical => $legacy) {
                if ($table === 'qa_decision_memory') {
                    $this->dropCollidingMemory($canonical, $legacy);
                }
                $this->db->table($table)
                    ->where($column, $canonical)
                    ->update([$column => $legacy]);
            }
            // production_restricted has no legacy equivalent — park it on the
            // closest observer-only tier so the app keeps refusing writes. That
            // collapses two tiers onto prod_basic, so drop the losers first.
            if ($table === 'qa_decision_memory') {
                $this->dropCollidingMemory(Environments::PRODUCTION_RESTRICTED, 'prod_basic');
            }
            $this->db->table($table)
                ->where($column, Environments::PRODUCTION_RESTRICTED)
                ->update([$column => 'prod_basic']);
        }
    }

    /**
     * Older deploys may carry CHECK constraints written against the legacy
     * values. Drop anything that mentions a legacy tier so the UPDATE can run.
     */
    private function dropEnvironmentChecks(): void
    {
        $rows = $this->db->query(
            "SELECT c.conname, t.relname AS table_name
             FROM pg_constraint c
             JOIN pg_class t ON t.oid = c.conrelid
             WHERE c.contype = 'c'
               AND t.relname IN ('qa_target_profiles', 'qa_runs', 'qa_decision_memory')
               AND pg_get_constraintdef(c.oid) ILIKE '%environment%'"
        )->getResultArray();

        foreach ($rows as $row) {
            $this->db->query(sprintf(
                'ALTER TABLE %s DROP CONSTRAINT IF EXISTS %s',
                $this->db->escapeIdentifiers($row['table_name']),
                $this->db->escapeIdentifiers($row['conname'])
            ));
        }
    }

    /**
     * Remove legacy-tier memory rows that would collide with a canonical row.
     *
     * The unique key is (product_name, environment, situation_key), so renaming
     * `prod_basic` to `production_readonly` fails when both spellings already
     * exist for the same product/situation. Every legacy tier in LEGACY_MAP has a
     * distinct target, so one pass per pair is enough, and re-running the
     * migration is a no-op because no legacy rows are left.
     */
    private function dedupeDecisionMemory(): void
    {
        foreach (Environments::LEGACY_MAP as $legacy => $canonical) {
            $this->dropCollidingMemory($legacy, $canonical);
        }
    }

    /**
     * Delete memory rows on `$from` that already have a twin on `$to`, so the
     * subsequent rename cannot violate the unique key. Identical `$from`/`$to`
     * would delete the row against itself, so that case is skipped.
     */
    private function dropCollidingMemory(string $from, string $to): void
    {
        if ($from === $to || ! $this->db->tableExists('qa_decision_memory')) {
            return;
        }

        $this->db->query(
            'DELETE FROM qa_decision_memory loser
             USING qa_decision_memory keeper
             WHERE loser.environment = ?
               AND keeper.environment = ?
               AND keeper.product_name = loser.product_name
               AND keeper.situation_key = loser.situation_key',
            [$from, $to]
        );
    }
}
