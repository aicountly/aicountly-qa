<?php

namespace App\Services\ConsoleAccess;

use CodeIgniter\Database\BaseConnection;
use Config\Database;

/**
 * qa_users / qa_roles / qa_user_roles implementation of UserRoleStore.
 * Roles are matched on qa_roles.slug (migration 2026-10-14-000033).
 */
class DbUserRoleStore implements UserRoleStore
{
    public function __construct(private ?BaseConnection $db = null)
    {
    }

    private function db(): BaseConnection
    {
        return $this->db ??= Database::connect();
    }

    public function roleSlugs(int $userId): array
    {
        $rows = $this->db()->table('qa_user_roles ur')
            ->select('r.slug')
            ->join('qa_roles r', 'r.id = ur.role_id')
            ->where('ur.user_id', $userId)
            ->get()->getResultArray();

        return array_values(array_filter(array_map(static fn (array $r): string => (string) ($r['slug'] ?? ''), $rows)));
    }

    public function replaceRoles(int $userId, array $slugs): void
    {
        $db    = $this->db();
        $roles = $slugs === []
            ? []
            : $db->table('qa_roles')->select('id, slug')->whereIn('slug', $slugs)->get()->getResultArray();

        if (count($roles) !== count(array_unique($slugs))) {
            log_message('error', 'Console role sync: some role slugs have no qa_roles row: ' . implode(',', $slugs));
        }

        $now = date('Y-m-d H:i:s');
        $db->transStart();
        $db->table('qa_user_roles')->where('user_id', $userId)->delete();
        foreach ($roles as $role) {
            $db->table('qa_user_roles')->insert([
                'user_id'    => $userId,
                'role_id'    => (int) $role['id'],
                'created_at' => $now,
            ]);
        }
        $db->transComplete();
    }

    public function recordConsoleLink(int $userId, ?int $consoleUserId, ?int $authzVersion, bool $rolesSynced): void
    {
        $patch = [];
        if ($consoleUserId !== null && $consoleUserId > 0) {
            $patch['console_user_id'] = $consoleUserId;
        }
        if ($authzVersion !== null) {
            $patch['authz_version'] = $authzVersion;
        }
        if ($rolesSynced) {
            $patch['roles_synced_at'] = date('Y-m-d H:i:s');
        }
        if ($patch === []) {
            return;
        }
        $patch['updated_at'] = date('Y-m-d H:i:s');
        $this->db()->table('qa_users')->where('id', $userId)->update($patch);
    }

    public function revokeSessions(int $userId): void
    {
        $db = $this->db();
        $db->transStart();
        $db->table('qa_user_roles')->where('user_id', $userId)->delete();
        $db->table('qa_users')->where('id', $userId)->update([
            'sessions_revoked_at' => date('Y-m-d H:i:s'),
            'roles_synced_at'     => null,
            'updated_at'          => date('Y-m-d H:i:s'),
        ]);
        $db->transComplete();
    }
}
