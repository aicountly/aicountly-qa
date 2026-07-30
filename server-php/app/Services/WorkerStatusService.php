<?php

namespace App\Services;

use App\Models\SettingsModel;

class WorkerStatusService
{
    private const HEARTBEAT_KEY = 'worker_heartbeat';
    private const ONLINE_WINDOW_SECONDS = 45;

    /** Dedicated Playwright worker identity (PM2 / QA_WORKER_ID). */
    public const DEFAULT_WORKER_ID = 'aicountly-qa-worker';

    /** Retired shared host — must not be shown as the current QA worker. */
    private const LEGACY_SHARED_HOST = 'worker.apis.aicountly.com';

    public function recordHeartbeat(string $workerId, ?string $package = null): void
    {
        $existing = (array) ((new SettingsModel())->getSetting(self::HEARTBEAT_KEY, []) ?? []);
        $payload  = [
            'worker_id'    => $workerId !== '' ? $workerId : self::DEFAULT_WORKER_ID,
            'last_seen_at' => gmdate('c'),
        ];
        if ($package !== null && $package !== '') {
            $payload['package'] = $package;
        } elseif (! empty($existing['package'])) {
            $payload['package'] = (string) $existing['package'];
        }

        (new SettingsModel())->setSetting(self::HEARTBEAT_KEY, $payload);
    }

    /** @return array{online: bool, last_seen_at: ?string, worker_id: ?string, package: ?string, seconds_since_last_seen: ?int} */
    public function status(): array
    {
        $hb = (array) ((new SettingsModel())->getSetting(self::HEARTBEAT_KEY, []) ?? []);
        $lastSeenAt = isset($hb['last_seen_at']) ? (string) $hb['last_seen_at'] : null;
        $last       = $lastSeenAt ? strtotime($lastSeenAt) : 0;
        $age        = $last > 0 ? time() - $last : null;
        $rawId      = isset($hb['worker_id']) ? (string) $hb['worker_id'] : null;
        $package    = isset($hb['package']) ? (string) $hb['package'] : null;

        return [
            'online'                  => $last > 0 && $age !== null && $age < self::ONLINE_WINDOW_SECONDS,
            'last_seen_at'            => $lastSeenAt,
            // Operator-facing id: prefer package / dedicated id; never advertise the legacy shared host.
            'worker_id'               => $this->displayWorkerId($rawId, $package),
            'package'                 => $package !== null && $package !== '' ? $package : null,
            'seconds_since_last_seen' => $age,
        ];
    }

    private function displayWorkerId(?string $workerId, ?string $package): ?string
    {
        foreach ([$package, $workerId] as $candidate) {
            if ($candidate === null || $candidate === '') {
                continue;
            }
            if (strcasecmp($candidate, self::LEGACY_SHARED_HOST) === 0) {
                continue;
            }
            return $candidate;
        }

        // Heartbeat exists but only carried the retired host — still surface the dedicated identity.
        if ($workerId !== null && $workerId !== '') {
            return self::DEFAULT_WORKER_ID;
        }

        return null;
    }
}
