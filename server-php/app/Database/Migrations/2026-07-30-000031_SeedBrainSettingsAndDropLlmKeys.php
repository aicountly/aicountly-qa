<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Existing deploys are already seeded, so the dead `llm_*` settings are
 * replaced by the `brain.*` family here rather than requiring a reseed.
 */
class SeedBrainSettingsAndDropLlmKeys extends Migration
{
    private const TABLE = 'qa_settings';

    private const LLM_KEYS = ['llm_enabled', 'llm_provider', 'llm_model'];

    public function up(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $this->db->table(self::TABLE)->whereIn('key', self::LLM_KEYS)->delete();

        $now = date('Y-m-d H:i:s');
        $rows = [
            ['key' => 'brain.vision_providers', 'value_json' => json_encode(['gemini', 'openai']), 'description' => 'Ordered vision-capable providers tried by the AI Brain for screenshot review.'],
            ['key' => 'brain.parallel_providers', 'value_json' => json_encode(['openai', 'perplexity']), 'description' => 'Providers queried in parallel for the text council before arbitration.'],
            ['key' => 'brain.data_providers', 'value_json' => json_encode(['perplexity', 'openai']), 'description' => 'Ordered providers tried sequentially for synthetic test-data generation.'],
            ['key' => 'brain.default_arbiter', 'value_json' => json_encode('gemini'), 'description' => 'Provider that arbitrates the council\'s final decision.'],
            ['key' => 'brain.timeout_seconds', 'value_json' => json_encode(60), 'description' => 'Per-provider request timeout in seconds for AI Brain calls.'],
            ['key' => 'brain.agent_mode', 'value_json' => json_encode('template'), 'description' => 'agent|template. Whether sessions run the vision agent or the deterministic template step loop.'],
            ['key' => 'brain.max_screens_per_session', 'value_json' => json_encode(60), 'description' => 'Safety ceiling on screens visited by the vision agent in one session.'],
        ];
        foreach ($rows as &$r) {
            $r['created_at'] = $now;
            $r['updated_at'] = $now;
        }
        unset($r);

        $this->db->table(self::TABLE)->ignore(true)->insertBatch($rows);
    }

    public function down(): void
    {
        if (! $this->db->tableExists(self::TABLE)) {
            return;
        }

        $this->db->table(self::TABLE)->whereIn('key', [
            'brain.vision_providers',
            'brain.parallel_providers',
            'brain.data_providers',
            'brain.default_arbiter',
            'brain.timeout_seconds',
            'brain.agent_mode',
            'brain.max_screens_per_session',
        ])->delete();

        $now = date('Y-m-d H:i:s');
        $rows = [
            ['key' => 'llm_enabled', 'value_json' => json_encode(false), 'description' => 'Enable LLM provider for session planner. Disabled by default.'],
            ['key' => 'llm_provider', 'value_json' => json_encode(''), 'description' => 'openai|anthropic|gemini. Stored as opaque string.'],
            ['key' => 'llm_model', 'value_json' => json_encode(''), 'description' => 'Model identifier (e.g. gpt-4o-mini, claude-3-5-sonnet).'],
        ];
        foreach ($rows as &$r) {
            $r['created_at'] = $now;
            $r['updated_at'] = $now;
        }
        unset($r);

        $this->db->table(self::TABLE)->ignore(true)->insertBatch($rows);
    }
}
