<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\SettingsModel;
use Config\Services;

class SettingsController extends BaseApiController
{
    public function index()
    {
        return $this->ok((new SettingsModel())->all());
    }

    public function update()
    {
        $body = $this->input();
        $m = new SettingsModel();
        foreach ($body as $key => $val) {
            $m->setSetting((string) $key, $val, $this->user()['id'] ?? null);
        }
        $this->audit('settings_update', ['metadata' => ['keys' => array_keys($body)]]);
        return $this->ok((new SettingsModel())->all());
    }

    /**
     * JWT-authenticated read of AI Brain provider health, so the Settings page
     * can show live configured/vision-capable state without the browser ever
     * holding the worker-only X-Worker-Token used by /worker/brain/health.
     */
    public function brainHealth()
    {
        return $this->ok(['providers' => Services::brain()->providerHealth()]);
    }
}
