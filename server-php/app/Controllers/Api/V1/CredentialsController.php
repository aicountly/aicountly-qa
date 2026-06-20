<?php

namespace App\Controllers\Api\V1;

use App\Controllers\BaseApiController;
use App\Models\CredentialsModel;
use App\Models\TargetProfilesModel;
use Config\Services;

class CredentialsController extends BaseApiController
{
    public function set(int $targetProfileId)
    {
        $profile = (new TargetProfilesModel())->find($targetProfileId);
        if (! $profile) {
            return $this->fail('Target profile not found.', 404);
        }

        $body = $this->input();
        $password = (string) ($body['password'] ?? '');
        if ($password === '') {
            return $this->fail('password is required.', 400);
        }

        $enc = Services::vault()->encrypt($password);
        $creds = new CredentialsModel();
        $existing = $creds->findByProfile($targetProfileId);

        $row = [
            'target_profile_id' => $targetProfileId,
            'secret_ciphertext' => $enc['ciphertext'],
            'iv'                => $enc['iv'],
            'auth_tag'          => $enc['tag'],
            'version'           => ($existing['version'] ?? 0) + 1,
            'rotated_at'        => date('Y-m-d H:i:s'),
            'created_by'        => $this->user()['id'] ?? null,
        ];

        if ($existing) {
            $creds->update($existing['id'], $row);
        } else {
            $creds->insert($row);
        }

        $this->audit('credential_change', [
            'subject_kind' => 'target_profile',
            'subject_id'   => $targetProfileId,
            'metadata'     => ['version' => $row['version']],
        ]);

        return $this->ok(['version' => $row['version']]);
    }

    public function clear(int $targetProfileId)
    {
        (new CredentialsModel())->where('target_profile_id', $targetProfileId)->delete();
        $this->audit('credential_clear', ['subject_kind' => 'target_profile', 'subject_id' => $targetProfileId]);
        return $this->ok(['cleared' => true]);
    }
}
