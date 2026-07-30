<?php

namespace App\Services\Brain\Adapters;

/**
 * Always-available no-AI fallback. Returns a stable, rules-based response so a
 * council with no configured providers still produces a usable JSON shape for
 * decision, data-quality, and synthetic-data tasks instead of erroring outright.
 *
 * Kept deliberately thin: BrainEnsemble never routes vision or sequential
 * data-provider calls through this adapter (see resolveMembers()), so these
 * fallbacks only matter when `brain.default_arbiter` is set to
 * "deterministic" or a future caller invokes it directly.
 */
class DeterministicAdapter extends AbstractAdapter
{
    public function name(): string
    {
        return 'deterministic';
    }

    public function isConfigured(): bool
    {
        return true;
    }

    public function complete(string $systemPrompt, string $userPrompt, array $options = []): array
    {
        $task = (string) ($options['task'] ?? 'unknown');

        switch ($task) {
            case 'arbitrate':
                $output = (array) ($options['parallel_outputs'] ?? []);
                $output = ['arbiter' => 'deterministic', 'merged' => $output];
                break;
            case 'feature_gap':
                $output = ['feature_gaps' => [], 'note' => 'Deterministic fallback: feature gaps require the worker reviewer module.'];
                break;
            case 'synthetic_data':
                $output = [
                    'fields' => [],
                    'note'   => 'Deterministic fallback: no synthetic data generated. Configure GEMINI/OPENAI/PERPLEXITY to enable AI-generated test data.',
                ];
                break;
            case 'navigation_wisdom':
            case 'ask_user':
                $output = $this->fallbackDecision($task, $userPrompt, $options);
                break;
            default:
                $output = ['note' => 'Deterministic fallback active. Configure an AI provider for richer output.'];
        }

        return [
            'provider'   => $this->name(),
            'model'      => 'rules-v1',
            'raw'        => json_encode($output, JSON_PRETTY_PRINT),
            'output'     => $output,
            'usage'      => [],
            'latency_ms' => 0,
            'sources'    => [],
        ];
    }

    /**
     * Generic no-AI decision: surfaces the question as-is and offers the
     * three safe, always-available options rather than guessing intent.
     *
     * @param array<string,mixed> $options
     * @return array{question:string,options:list<array{id:string,label:string,action:string}>,recommended:string}
     */
    private function fallbackDecision(string $task, string $userPrompt, array $options): array
    {
        $context = is_array($options['context'] ?? null) ? $options['context'] : [];

        $questionHint = trim((string) ($context['question'] ?? ''));
        if ($questionHint === '') {
            $questionHint = trim($userPrompt);
        }

        return [
            'question' => $questionHint !== ''
                ? $questionHint
                : ($task === 'navigation_wisdom'
                    ? 'The next navigation step is ambiguous. How should the QA run proceed?'
                    : 'Worker input is required. How should the QA run proceed?'),
            'options' => [
                [
                    'id'     => 'rescan_menus',
                    'label'  => 'Rescan the current screen',
                    'action' => 'rescan_menus',
                ],
                [
                    'id'     => 'skip_target',
                    'label'  => 'Skip this target',
                    'action' => 'skip_target',
                ],
                [
                    'id'     => 'abort_session',
                    'label'  => 'Abort this session',
                    'action' => 'abort_session',
                ],
            ],
            'recommended' => 'rescan_menus',
        ];
    }
}
