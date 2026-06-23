<?php

namespace App\Services;

use App\Models\SettingsModel;

class WorkerStatusService
{
    private const HEARTBEAT_KEY = 'worker_heartbeat';
    private const ONLINE_WINDOW_SECONDS = 45;

    public function recordHeartbeat(string $workerId): void
    {
        (new SettingsModel())->setSetting(self::HEARTBEAT_KEY, [
            'worker_id'     => $workerId,
            'last_seen_at'  => gmdate('c'),
        ]);
    }

    /** @return array{online: bool, last_seen_at: ?string, worker_id: ?string, seconds_since_last_seen: ?int} */
    public function status(): array
    {
        $hb = (array) ((new SettingsModel())->getSetting(self::HEARTBEAT_KEY, []) ?? []);
        $lastSeenAt = isset($hb['last_seen_at']) ? (string) $hb['last_seen_at'] : null;
        $last       = $lastSeenAt ? strtotime($lastSeenAt) : 0;
        $age        = $last > 0 ? time() - $last : null;

        return [
            'online'                  => $last > 0 && $age !== null && $age < self::ONLINE_WINDOW_SECONDS,
            'last_seen_at'            => $lastSeenAt,
            'worker_id'               => isset($hb['worker_id']) ? (string) $hb['worker_id'] : null,
            'seconds_since_last_seen' => $age,
        ];
    }
}
