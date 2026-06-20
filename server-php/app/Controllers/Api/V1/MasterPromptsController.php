<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\MasterPromptsModel;
use App\Models\RunsModel;
use App\Models\TargetProfilesModel;
use Config\Services;

class MasterPromptsController extends BaseApiController
{
    public function index()
    {
        $runId = $this->request->getGet('qa_run_id');
        $m = new MasterPromptsModel();
        if ($runId) {
            $m->where('qa_run_id', $runId);
        }
        return $this->ok($m->orderBy('id', 'DESC')->findAll());
    }

    public function create()
    {
        $body = $this->input();
        $targetProfileId = (int) ($body['target_profile_id'] ?? 0);
        $prompt          = trim((string) ($body['prompt_text'] ?? ''));
        $kind            = (string) ($body['prompt_kind'] ?? 'template');

        if ($targetProfileId <= 0 || $prompt === '') {
            return $this->fail('target_profile_id and prompt_text are required.', 400);
        }

        $profile = (new TargetProfilesModel())->find($targetProfileId);
        if (! $profile) {
            return $this->fail('Target profile not found.', 404);
        }

        $runs    = new RunsModel();
        $runId   = Services::runId()->next();
        $userId  = $this->user()['id'] ?? null;

        $runs->insert([
            'qa_run_id'         => $runId,
            'target_profile_id' => $targetProfileId,
            'product_name'      => $profile['product_name'],
            'environment'       => $profile['environment'],
            'created_by'        => $userId,
            'status'            => 'pending',
        ]);

        $prompts = new MasterPromptsModel();
        $promptId = $prompts->insert([
            'qa_run_id'         => $runId,
            'user_id'           => $userId,
            'target_profile_id' => $targetProfileId,
            'prompt_text'       => $prompt,
            'prompt_kind'       => in_array($kind, ['template', 'llm', 'hybrid'], true) ? $kind : 'template',
            'created_at'        => date('Y-m-d H:i:s'),
        ], true);

        $this->audit('master_prompt_submit', [
            'qa_run_id'    => $runId,
            'subject_kind' => 'master_prompt',
            'subject_id'   => $promptId,
        ]);

        // Auto-generate a draft session plan.
        $plan = Services::sessionPlanner()->generateDraft($runId, $targetProfileId, $prompt, $kind);

        $this->audit('session_plan_generated', [
            'qa_run_id' => $runId,
            'metadata'  => ['sessions' => count($plan['sessions'] ?? [])],
        ]);

        return $this->ok([
            'qa_run_id'    => $runId,
            'prompt_id'    => $promptId,
            'session_plan' => $plan,
        ], 201);
    }
}
