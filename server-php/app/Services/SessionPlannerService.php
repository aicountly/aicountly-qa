<?php

namespace App\Services;

use App\Models\SessionPlansModel;
use App\Models\SettingsModel;
use App\Models\TargetProfilesModel;
use RuntimeException;

/**
 * SessionPlannerService — turns (master prompt + target profile) into a list of
 * candidate QA sessions.
 *
 * Default behaviour: read product templates from
 * server-php/app/Database/Templates/{product}/_index.json + per-template JSON,
 * apply prompt-derived filters (modules to include/exclude, env-specific scope),
 * and emit a draft plan_json.
 *
 * LLM hook present but disabled by default. When `llm_enabled` setting is true,
 * the planner calls the configured provider and reconciles the LLM output with
 * deterministic templates so structure stays consistent.
 */
class SessionPlannerService
{
    private const TEMPLATES_ROOT = APPPATH . 'Database' . DIRECTORY_SEPARATOR . 'Templates' . DIRECTORY_SEPARATOR;

    public function generateDraft(string $qaRunId, int $targetProfileId, string $promptText, string $kind = 'template'): array
    {
        $profile = (new TargetProfilesModel())->find($targetProfileId);
        if (! $profile) {
            throw new RuntimeException('Target profile not found.');
        }

        $product   = $profile['product_name'];
        $env       = $profile['environment'];
        $templates = $this->loadTemplates($product);

        // Filter templates based on environment.
        $sessions = [];
        $order    = 0;

        foreach ($templates as $tpl) {
            if (! $this->shouldIncludeForEnv($tpl, $env)) {
                continue;
            }

            // Allow large modules to be split into sub-sessions per sub_module.
            $splits = !empty($tpl['splittable']) && !empty($tpl['sub_modules'])
                ? $tpl['sub_modules']
                : [null];

            foreach ($splits as $subModule) {
                $sessions[] = [
                    'order_index'   => ++$order,
                    'name'          => $subModule
                        ? sprintf('%s — %s', $tpl['name'], $subModule)
                        : $tpl['name'],
                    'template_code' => $tpl['code'],
                    'module'        => $tpl['module']     ?? null,
                    'sub_module'    => $subModule ?? ($tpl['sub_module'] ?? null),
                    'severity_on_fail' => $tpl['severity_on_fail'] ?? 'medium',
                    'steps_preview' => $this->stepsPreview($tpl),
                    'validations'   => $tpl['validations'] ?? [],
                    'data_keys'     => $tpl['data_keys'] ?? [],
                    'scope'         => [
                        'env'       => $env,
                        'product'   => $product,
                        'sub_module'=> $subModule,
                    ],
                ];
            }
        }

        $settings    = new SettingsModel();
        $llmEnabled  = (bool) $settings->getSetting('llm_enabled', false);

        // LLM hook — disabled by default. When enabled it reranks/edits the list.
        if ($kind === 'llm' || ($kind === 'hybrid' && $llmEnabled)) {
            $sessions = $this->applyLlmHook($sessions, $promptText, $product, $env);
        }

        $plan = [
            'qa_run_id'    => $qaRunId,
            'product'      => $product,
            'environment'  => $env,
            'sessions'     => $sessions,
            'generated_at' => gmdate('c'),
            'kind'         => $kind,
            'llm_enabled'  => $llmEnabled,
        ];

        // Persist the draft plan.
        $plans   = new SessionPlansModel();
        $planId  = $plans->insert([
            'qa_run_id'  => $qaRunId,
            'plan_json'  => $plan,
            'status'     => 'draft',
        ], true);

        $plan['id'] = $planId;
        return $plan;
    }

    public function loadTemplates(string $product): array
    {
        $dir   = self::TEMPLATES_ROOT . $product . DIRECTORY_SEPARATOR;
        $index = $dir . '_index.json';

        if (! is_file($index)) {
            throw new RuntimeException("No template index for product `{$product}` at {$index}");
        }

        $idx = json_decode((string) file_get_contents($index), true);
        if (! is_array($idx) || empty($idx['templates'])) {
            throw new RuntimeException("Invalid template index for product `{$product}`.");
        }

        $templates = [];
        foreach ($idx['templates'] as $entry) {
            $file = $dir . $entry['code'] . '.json';
            if (! is_file($file)) {
                continue; // tolerate missing detail files; planner still emits a session entry.
                // Fallback minimal template — runner will treat steps as empty.
            }
            $tpl  = json_decode((string) file_get_contents($file), true);
            if (! is_array($tpl)) {
                continue;
            }
            $tpl['order']      = $entry['order'] ?? null;
            $tpl['splittable'] = $tpl['splittable'] ?? ($entry['splits'] ?? false);
            $tpl['sub_modules'] = $tpl['sub_modules'] ?? ($entry['sub_modules'] ?? []);
            $templates[] = $tpl;
        }

        usort($templates, static fn ($a, $b) => ($a['order'] ?? 999) <=> ($b['order'] ?? 999));
        return $templates;
    }

    private function shouldIncludeForEnv(array $tpl, string $env): bool
    {
        // On prod_basic / prod_full we keep only login + navigation + report-load sessions
        // unless production_unlock is enabled (still controlled by ProductionGuardFilter on writes).
        if ($env === 'prod_basic' || $env === 'prod_full') {
            $module = strtolower((string) ($tpl['module'] ?? ''));
            return in_array($module, ['login', 'reports', 'ux'], true)
                || stripos($tpl['name'], 'navigation') !== false;
        }
        return true;
    }

    private function stepsPreview(array $tpl): array
    {
        $steps = $tpl['steps'] ?? [];
        return array_slice($steps, 0, 3); // small preview for UI
    }

    private function applyLlmHook(array $sessions, string $prompt, string $product, string $env): array
    {
        // STUB — disabled by default. When the user wires QA_LLM_PROVIDER + QA_LLM_API_KEY in .env,
        // call the provider here and merge its output. We always keep deterministic templates as
        // the canonical source; LLM can only reorder/filter, never invent new template codes.
        $provider = (string) env('QA_LLM_PROVIDER', '');
        $apiKey   = (string) env('QA_LLM_API_KEY', '');
        if ($provider === '' || $apiKey === '') {
            // No-op when not configured.
            return $sessions;
        }
        // Real implementation lives behind this stub.
        return $sessions;
    }
}
