<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\MasterPromptsModel;
use App\Models\RunsModel;
use App\Models\SessionPlansModel;
use App\Models\TargetProfilesModel;
use Config\Environments;
use Config\Services;

class MasterPromptsController extends BaseApiController
{
    /** @var list<string> */
    private const PROMPT_KINDS = ['template', 'llm', 'hybrid'];

    public function index()
    {
        $runId = $this->request->getGet('qa_run_id');
        $m = new MasterPromptsModel();
        if ($runId) {
            $m->where('qa_run_id', $runId);
        }
        return $this->ok($m->orderBy('id', 'DESC')->findAll());
    }

    /**
     * Error-focused master prompt samples, split into product matches and the rest.
     * GET /api/v1/master-prompts-samples?product_name=books
     */
    public function samples()
    {
        $product = trim((string) ($this->request->getGet('product_name') ?? ''));

        return $this->ok((new \App\Services\MasterPromptSampleCatalog())->forProduct($product));
    }

    /**
     * Create the run + prompt + draft session plan in one call.
     *
     * Body: { target_profile_id, environment?, title?, prompt_text, prompt_kind? }
     * `prompt_kind` is optional (defaults to `template`) because the New QA Run
     * form no longer exposes a generation mode.
     */
    public function create()
    {
        $body            = $this->input();
        $targetProfileId = (int) ($body['target_profile_id'] ?? 0);
        $prompt          = trim((string) ($body['prompt_text'] ?? ''));
        $title           = trim((string) ($body['title'] ?? ''));
        $kind            = strtolower(trim((string) ($body['prompt_kind'] ?? 'template')));
        $kind            = in_array($kind, self::PROMPT_KINDS, true) ? $kind : 'template';

        if ($targetProfileId <= 0 || $prompt === '') {
            return $this->fail('target_profile_id and prompt_text are required.', 400);
        }

        $profile = (new TargetProfilesModel())->find($targetProfileId);
        if (! $profile) {
            return $this->fail('Target profile not found.', 404);
        }

        $profileEnv = Environments::normalize((string) ($profile['environment'] ?? ''));
        $requested  = trim((string) ($body['environment'] ?? ''));
        $environment = $requested !== '' ? Environments::normalize($requested) : $profileEnv;

        if (! Environments::isKnown($environment)) {
            return $this->fail(
                'Unknown environment "' . $requested . '". Allowed: ' . implode(', ', Environments::ALL) . '.',
                422
            );
        }

        $envError = $this->environmentConflict($profileEnv, $environment);
        if ($envError !== null) {
            return $this->fail($envError, 422);
        }

        if (($profile['status'] ?? 'active') !== 'active') {
            return $this->fail('Target profile is not active.', 409);
        }

        $runs   = new RunsModel();
        $runId  = Services::runId()->next();
        $userId = $this->user()['id'] ?? null;
        $title  = $title !== '' ? mb_substr($title, 0, 191) : $this->titleFromPrompt($prompt);

        $runs->insert([
            'qa_run_id'         => $runId,
            'target_profile_id' => $targetProfileId,
            'product_name'      => $profile['product_name'],
            'environment'       => $environment,
            'title'             => $title,
            'created_by'        => $userId,
            'status'            => 'pending',
        ]);

        $prompts  = new MasterPromptsModel();
        $promptId = (int) $prompts->insert([
            'qa_run_id'         => $runId,
            'user_id'           => $userId,
            'target_profile_id' => $targetProfileId,
            'title'             => $title,
            'prompt_text'       => $prompt,
            'prompt_kind'       => $kind,
            'created_at'        => date('Y-m-d H:i:s'),
        ], true);

        $this->audit('master_prompt_submit', [
            'qa_run_id'    => $runId,
            'subject_kind' => 'master_prompt',
            'subject_id'   => $promptId,
            'metadata'     => ['environment' => $environment, 'title' => $title],
        ]);

        $plan = Services::sessionPlanner()->generateDraft(
            $runId,
            $targetProfileId,
            $prompt,
            $kind,
            ['environment' => $environment, 'master_prompt_id' => $promptId, 'title' => $title]
        );

        $planId = (int) ($plan['id'] ?? 0);

        $this->audit('session_plan_generated', [
            'qa_run_id' => $runId,
            'metadata'  => ['sessions' => count($plan['sessions'] ?? []), 'plan_id' => $planId],
        ]);

        return $this->ok([
            'qa_run_id'    => $runId,
            'prompt_id'    => $promptId,
            'plan_id'      => $planId,
            'session_plan' => $plan,
        ], 201);
    }

    /**
     * A run may tighten the profile's tier but never loosen it: an observer-only
     * profile cannot be run as sandbox just because the form said so.
     */
    private function environmentConflict(string $profileEnv, string $requested): ?string
    {
        if ($profileEnv === $requested) {
            return null;
        }

        if (Environments::isObserverOnly($profileEnv) && ! Environments::isObserverOnly($requested)) {
            return sprintf(
                'Target profile is pinned to the observer-only tier "%s"; a run cannot upgrade it to "%s". '
                . 'Change the profile environment first.',
                $profileEnv,
                $requested
            );
        }

        if (! Environments::isProduction($profileEnv) && Environments::isProduction($requested)) {
            return sprintf(
                'Target profile "%s" is a non-production target; it cannot be run against "%s".',
                $profileEnv,
                $requested
            );
        }

        return null;
    }

    private function titleFromPrompt(string $prompt): string
    {
        $firstLine = trim((string) strtok($prompt, "\n"));
        $firstLine = $firstLine !== '' ? $firstLine : $prompt;

        return mb_substr($firstLine, 0, 191);
    }
}
