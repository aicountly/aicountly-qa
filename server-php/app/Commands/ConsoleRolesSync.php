<?php

namespace App\Commands;

use App\Models\UsersModel;
use CodeIgniter\CLI\BaseCommand;
use CodeIgniter\CLI\CLI;
use Config\Services;

/**
 * php spark qa:console-roles-sync
 *
 * Re-confirms every active QA user's roles with Console (user-access pull):
 * revoked users lose their roles and sessions, everyone else gets exactly the
 * roles Console assigns. Optional — JwtFilter already re-checks each user
 * every QA_CONSOLE_RECHECK_MINUTES while they use the portal — but a cron entry
 * also catches users who are idle with a still-valid token, e.g.:
 *
 *   * /15 * * * *  cd ~/public_html/api && php spark qa:console-roles-sync >/dev/null 2>&1
 */
class ConsoleRolesSync extends BaseCommand
{
    protected $group       = 'QA';
    protected $name        = 'qa:console-roles-sync';
    protected $description = 'Re-sync every active QA user\'s roles from Console (needs CONSOLE_API_URL + CONSOLE_API_TOKEN).';

    public function run(array $params)
    {
        $sync = Services::consoleRoleSync();
        if (! $sync->isPullConfigured()) {
            CLI::error('CONSOLE_API_URL and CONSOLE_API_TOKEN must both be set; nothing to do.');

            return EXIT_ERROR;
        }

        $users  = new UsersModel();
        $rows   = $users->where('status', 'active')->findAll();
        $counts = ['synced' => 0, 'revoked' => 0, 'kept' => 0, 'refused' => 0];

        foreach ($rows as $row) {
            $decision = $sync->checkAccess($row, true);
            if (! $decision->allowed) {
                $counts[$decision->revoke ? 'revoked' : 'refused']++;
                if ($decision->revoke) {
                    Services::auditService()->log('console_access_revoked', [
                        'actor_email'  => $row['email'],
                        'subject_kind' => 'user',
                        'subject_id'   => (int) $row['id'],
                        'metadata'     => ['via' => 'qa:console-roles-sync'],
                    ]);
                }
                continue;
            }
            $counts[$decision->roles !== null ? 'synced' : 'kept']++;
        }

        CLI::write(sprintf(
            'Console role sync: %d users — %d synced, %d revoked, %d kept (Console unreachable, within 12h), %d refused (unreachable, stale).',
            count($rows),
            $counts['synced'],
            $counts['revoked'],
            $counts['kept'],
            $counts['refused'],
        ));

        return EXIT_SUCCESS;
    }
}
