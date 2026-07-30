<?php

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class SettingsSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            ['key' => 'brain.vision_providers',   'value_json' => json_encode(['gemini', 'openai']), 'description' => 'Ordered vision-capable providers tried by the AI Brain for screenshot review.'],
            ['key' => 'brain.parallel_providers', 'value_json' => json_encode(['openai', 'perplexity']), 'description' => 'Providers queried in parallel for the text council before arbitration.'],
            ['key' => 'brain.data_providers',     'value_json' => json_encode(['perplexity', 'openai']), 'description' => 'Ordered providers tried sequentially for synthetic test-data generation.'],
            ['key' => 'brain.default_arbiter',    'value_json' => json_encode('gemini'), 'description' => 'Provider that arbitrates the council\'s final decision.'],
            ['key' => 'brain.timeout_seconds',    'value_json' => json_encode(60), 'description' => 'Per-provider request timeout in seconds for AI Brain calls.'],
            ['key' => 'brain.agent_mode',         'value_json' => json_encode('template'), 'description' => 'agent|template. Whether sessions run the vision agent or the deterministic template step loop.'],
            ['key' => 'brain.max_screens_per_session', 'value_json' => json_encode(60), 'description' => 'Safety ceiling on screens visited by the vision agent in one session.'],
            ['key' => 'flow_webhook_enabled',    'value_json' => json_encode(false), 'description' => 'Enable flow.aicountly.org ticket creation. Off by default.'],
            ['key' => 'flow_webhook_url',        'value_json' => json_encode(''),    'description' => 'flow.aicountly.org ticket webhook URL.'],
            ['key' => 'production_unlock',       'value_json' => json_encode(['enabled' => false, 'expires_at' => null, 'unlocked_by' => null]), 'description' => 'Owner-only per-run unlock for production writes.'],
            ['key' => 'default_templates',       'value_json' => json_encode(['books' => 'all']), 'description' => 'Default templates loaded by Session Planner per product.'],
            ['key' => 'theme_brand_colour',      'value_json' => json_encode('#16a34a'), 'description' => 'AICOUNTLY green-white primary colour reference.'],
            ['key' => 'restricted_action_words', 'value_json' => json_encode([
                'Delete', 'Remove', 'Reset', 'Finalize', 'Finalise',
                'File Return', 'Generate E-Invoice', 'Generate E-Way Bill',
                'Submit to GST', 'Sync Live', 'Approve', 'Reject', 'Post Permanently',
            ]), 'description' => 'Words blocked by safeActionGuard on production targets.'],
        ];

        $now = date('Y-m-d H:i:s');
        foreach ($rows as &$r) {
            $r['created_at'] = $now;
            $r['updated_at'] = $now;
        }

        $this->db->table('qa_settings')->ignore(true)->insertBatch($rows);
    }
}
