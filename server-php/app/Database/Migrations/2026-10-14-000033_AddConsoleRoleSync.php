<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

/**
 * Console assigns QA roles (app_code `qa`). Adds:
 *  - qa_roles.slug (owner, qa_manager, developer_viewer, auditor_viewer) so
 *    Console slugs map onto the existing role rows; missing roles are created.
 *  - qa_users.console_user_id / roles_synced_at / authz_version — the Console
 *    link and when the local roles were last confirmed by Console.
 *  - qa_users.sessions_revoked_at — tokens issued before it are refused.
 */
class AddConsoleRoleSync extends Migration
{
    private const ROLES = [
        'owner'            => ['Owner', 'Full control. Can manage users, target profiles, credentials, approve sessions, run tests, change settings, unlock production write mode.'],
        'qa_manager'       => ['QA Manager', 'Can manage target profiles, approve sessions and run QA tests. Cannot change global settings or unlock production write mode.'],
        'developer_viewer' => ['Developer Viewer', 'Read-only access to QA reports, error register and validation results. No write access.'],
        'auditor_viewer'   => ['Auditor Viewer', 'Read-only access to selected final reports and audit logs only.'],
    ];

    public function up(): void
    {
        $this->db->query('ALTER TABLE qa_roles ADD COLUMN IF NOT EXISTS slug VARCHAR(64) NULL');

        foreach (self::ROLES as $slug => [$code, $description]) {
            $this->db->query('UPDATE qa_roles SET slug = ? WHERE code = ? AND slug IS NULL', [$slug, $code]);
            $this->db->query(
                'INSERT INTO qa_roles (code, name, description, slug, created_at, updated_at)
                 SELECT ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                 WHERE NOT EXISTS (SELECT 1 FROM qa_roles WHERE code = ? OR slug = ?)',
                [$code, $code, $description, $slug, $code, $slug],
            );
        }

        $this->db->query('CREATE UNIQUE INDEX IF NOT EXISTS qa_roles_slug_unique ON qa_roles (slug) WHERE slug IS NOT NULL');

        $this->db->query('ALTER TABLE qa_users ADD COLUMN IF NOT EXISTS console_user_id BIGINT NULL');
        $this->db->query('ALTER TABLE qa_users ADD COLUMN IF NOT EXISTS roles_synced_at TIMESTAMP NULL');
        $this->db->query('ALTER TABLE qa_users ADD COLUMN IF NOT EXISTS authz_version INTEGER NULL');
        $this->db->query('ALTER TABLE qa_users ADD COLUMN IF NOT EXISTS sessions_revoked_at TIMESTAMP NULL');
        $this->db->query('CREATE INDEX IF NOT EXISTS qa_users_console_user_id_idx ON qa_users (console_user_id)');
    }

    public function down(): void
    {
        $this->db->query('DROP INDEX IF EXISTS qa_users_console_user_id_idx');
        $this->db->query('ALTER TABLE qa_users DROP COLUMN IF EXISTS sessions_revoked_at');
        $this->db->query('ALTER TABLE qa_users DROP COLUMN IF EXISTS authz_version');
        $this->db->query('ALTER TABLE qa_users DROP COLUMN IF EXISTS roles_synced_at');
        $this->db->query('ALTER TABLE qa_users DROP COLUMN IF EXISTS console_user_id');
        $this->db->query('DROP INDEX IF EXISTS qa_roles_slug_unique');
        $this->db->query('ALTER TABLE qa_roles DROP COLUMN IF EXISTS slug');
    }
}
