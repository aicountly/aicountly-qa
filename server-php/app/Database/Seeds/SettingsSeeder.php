<?php

namespace App\Database\Seeds;

use CodeIgniter\Database\Seeder;

class SettingsSeeder extends Seeder
{
    public function run(): void
    {
        $rows = [
            ['key' => 'llm_enabled',             'value_json' => json_encode(false), 'description' => 'Enable LLM provider for session planner. Disabled by default.'],
            ['key' => 'llm_provider',            'value_json' => json_encode(''),    'description' => 'openai|anthropic|gemini. Stored as opaque string.'],
            ['key' => 'llm_model',               'value_json' => json_encode(''),    'description' => 'Model identifier (e.g. gpt-4o-mini, claude-3-5-sonnet).'],
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
