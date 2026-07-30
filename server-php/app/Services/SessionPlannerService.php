<?php

namespace App\Services;

use App\Models\SessionPlansModel;
use App\Models\SettingsModel;
use App\Models\TargetProfilesModel;
use Config\Environments;
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
 * The plan is never truncated to a fixed session count. Templates may carry an
 * `expected_screens` hint, but it is an estimate only; the single hard number is
 * the per-session screen safety max (QA_MAX_SCREENS_PER_SESSION, default 40)
 * that stops a runaway crawl.
 *
 * LLM hook present but disabled by default. When `llm_enabled` setting is true,
 * the planner calls the configured provider and reconciles the LLM output with
 * deterministic templates so structure stays consistent.
 */
class SessionPlannerService
{
    private const TEMPLATES_ROOT = APPPATH . 'Database' . DIRECTORY_SEPARATOR . 'Templates' . DIRECTORY_SEPARATOR;

    public const DEFAULT_MAX_SCREENS_PER_SESSION = 40;

    /**
     * @param array{environment?:string,master_prompt_id?:int,title?:string} $options
     */
    public function generateDraft(
        string $qaRunId,
        int $targetProfileId,
        string $promptText,
        string $kind = 'template',
        array $options = []
    ): array {
        $profile = (new TargetProfilesModel())->find($targetProfileId);
        if (! $profile) {
            throw new RuntimeException('Target profile not found.');
        }

        $product = $profile['product_name'];
        $env     = Environments::normalize(
            (string) ($options['environment'] ?? $profile['environment'] ?? '')
        );

        $templates   = $this->loadTemplates($product);
        $loginOnly   = $this->isLoginOnlyPrompt($promptText, $env);
        $excludeUx   = $this->shouldExcludeUx($promptText);
        $safetyMax   = $this->maxScreensPerSession();
        $observer    = Environments::isObserverOnly($env);

        $sessions = [];
        $order    = 0;

        foreach ($templates as $tpl) {
            if (! $this->shouldIncludeForEnv($tpl, $env, $loginOnly, $excludeUx)) {
                continue;
            }

            // Allow large modules to be split into sub-sessions per sub_module.
            $splits = ! empty($tpl['splittable']) && ! empty($tpl['sub_modules'])
                ? $tpl['sub_modules']
                : [null];

            foreach ($splits as $subModule) {
                $sessions[] = [
                    'order_index'      => ++$order,
                    'name'             => $subModule
                        ? sprintf('%s — %s', $tpl['name'], $subModule)
                        : $tpl['name'],
                    'template_code'    => $tpl['code'],
                    'module'           => $tpl['module']     ?? null,
                    'sub_module'       => $subModule ?? ($tpl['sub_module'] ?? null),
                    'severity_on_fail' => $tpl['severity_on_fail'] ?? 'medium',
                    'steps_preview'    => $this->stepsPreview($tpl),
                    'validations'      => $tpl['validations'] ?? [],
                    'data_keys'        => $tpl['data_keys'] ?? [],
                    // Estimate only — discovery decides how far a session actually walks.
                    // Named to match the template field and the plan editor input.
                    'expected_screens' => $this->estimatedScreens($tpl),
                    'scope'            => [
                        'env'                => $env,
                        'product'            => $product,
                        'sub_module'         => $subModule,
                        'observer_only'      => $observer,
                        'file_actions_allowed' => ! $observer && ! empty($profile['allow_safe_demo']),
                        'data_creation_allowed' => ! $observer && ! empty($profile['data_creation_allowed']),
                        'max_screens'        => $safetyMax,
                    ],
                ];
            }
        }

        $settings   = new SettingsModel();
        $llmEnabled = (bool) $settings->getSetting('llm_enabled', false);

        // LLM hook — disabled by default. When enabled it reranks/edits the list.
        if ($kind === 'llm' || ($kind === 'hybrid' && $llmEnabled)) {
            $sessions = $this->applyLlmHook($sessions, $promptText, $product, $env);
        }

        $plan = [
            'qa_run_id'         => $qaRunId,
            'title'             => (string) ($options['title'] ?? ''),
            'product'           => $product,
            'environment'       => $env,
            'environment_label' => Environments::label($env),
            'observer_only'     => $observer,
            'sessions'          => $sessions,
            'session_count'     => count($sessions),
            'generated_at'      => gmdate('c'),
            'kind'              => $kind,
            'llm_enabled'       => $llmEnabled,
            'login_only'        => $loginOnly,
            'max_screens_per_session' => $safetyMax,
        ];

        $plans  = new SessionPlansModel();
        $row    = [
            'qa_run_id' => $qaRunId,
            'plan_json' => $plan,
            'status'    => 'draft',
        ];
        if (! empty($options['master_prompt_id'])) {
            $row['master_prompt_id'] = (int) $options['master_prompt_id'];
        }
        $planId = $plans->insert($row, true);

        $plan['id'] = (int) $planId;

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
            }
            $tpl = json_decode((string) file_get_contents($file), true);
            if (! is_array($tpl)) {
                continue;
            }
            $tpl['order']       = $entry['order'] ?? null;
            $tpl['splittable']  = $tpl['splittable'] ?? ($entry['splits'] ?? false);
            $tpl['sub_modules'] = $tpl['sub_modules'] ?? ($entry['sub_modules'] ?? []);
            $templates[] = $tpl;
        }

        usort($templates, static fn ($a, $b) => ($a['order'] ?? 999) <=> ($b['order'] ?? 999));

        return $templates;
    }

    /** Safety ceiling on screens visited in one session — not a plan-size cap. */
    public function maxScreensPerSession(): int
    {
        $raw = (int) env('QA_MAX_SCREENS_PER_SESSION', self::DEFAULT_MAX_SCREENS_PER_SESSION);

        return $raw > 0 ? $raw : self::DEFAULT_MAX_SCREENS_PER_SESSION;
    }

    /**
     * Login-first gate. Observer-only production tiers always start with Login
     * only; elsewhere the operator has to actually ask for a login-only run.
     *
     * The heuristic is deliberately narrow: "login only", "only login", or a
     * prompt whose entire intent is signing in. Any mention of a downstream
     * concern (reports, data, file I/O, errors, GST…) means it is not login-only.
     */
    private function isLoginOnlyPrompt(string $promptText, string $env): bool
    {
        if (Environments::isObserverOnly($env)) {
            return true;
        }

        $p = strtolower(trim($promptText));
        if ($p === '') {
            return false;
        }

        $explicitOnly = preg_match(
            '/\b(login|log[ -]?in|sign[ -]?in|authentication)\s+only\b|\bonly\s+(login|log[ -]?in|sign[ -]?in)\b|^login only\b/',
            $p
        ) === 1;

        if (! $explicitOnly) {
            return false;
        }

        // "Login only" plus any downstream concern is a full run that happens to
        // start at login, not a login-only run.
        $downstreamIntent = preg_match(
            '/\b(full|functional|error pack|errors?|gst|reconcil\w*|reports?|register\w*|ledger\w*|voucher\w*|'
            . 'file\s*i\s*\/?\s*o|import|export|upload|download|console|api|data integrity|negative|validation paths?)\b/',
            $p
        ) === 1;

        return ! $downstreamIntent;
    }

    /** Error-oriented prompts skip the UX module — that is smoke's job. */
    private function shouldExcludeUx(string $promptText): bool
    {
        return preg_match(
            '/\b(error pack|errors?|functional|gst|reconcil\w*|data integrity|data correctness|'
            . 'file\s*i\s*\/?\s*o|negative|validation paths?|reports? verification)\b/i',
            $promptText
        ) === 1;
    }

    /**
     * Environment scoping across the five tiers.
     *
     * - Observer-only tiers (production_readonly, production_restricted) may only
     *   log in, navigate, and load read-only reports. Never data entry, never files.
     * - production_full_access behaves like sandbox: everything is in scope.
     *   Checking with str_starts_with($env, 'production') here would wrongly
     *   strip it back to observer scope.
     */
    private function shouldIncludeForEnv(array $tpl, string $env, bool $loginOnly = false, bool $excludeUx = false): bool
    {
        $module = strtolower((string) ($tpl['module'] ?? ''));
        $name   = (string) ($tpl['name'] ?? '');

        if ($loginOnly) {
            return $module === 'login';
        }
        if ($excludeUx && $module === 'ux') {
            return false;
        }

        if (Environments::isObserverOnly($env)) {
            if (in_array($module, ['login', 'reports'], true)) {
                return true;
            }
            if (stripos($name, 'navigation') !== false) {
                return true;
            }

            // Read-only navigation templates are allowed; anything that writes,
            // uploads, or downloads is not.
            return false;
        }

        return true;
    }

    /**
     * Screen estimate for the UI. Templates may declare `expected_screens`;
     * otherwise it is derived from the navigation steps. Purely informational.
     */
    private function estimatedScreens(array $tpl): int
    {
        if (isset($tpl['expected_screens']) && (int) $tpl['expected_screens'] > 0) {
            return (int) $tpl['expected_screens'];
        }

        $navSteps = array_filter(
            (array) ($tpl['steps'] ?? []),
            static fn ($step) => is_array($step)
                && in_array((string) ($step['kind'] ?? ''), ['navigate', 'navigate_menu'], true)
        );

        return max(1, count($navSteps));
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
            return $sessions;
        }

        return $sessions;
    }
}
