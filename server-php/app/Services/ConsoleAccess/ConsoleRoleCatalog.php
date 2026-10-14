<?php

namespace App\Services\ConsoleAccess;

/**
 * The QA role slugs Console can assign (Console app_code `qa`).
 *
 * Console is the source of truth for who holds which role; this catalog only
 * lists the slugs QA understands. Local `qa_roles` rows are matched on their
 * `slug` column (the human `code` such as "QA Manager" is what RoleFilter and
 * the SPA check, and is unchanged).
 */
final class ConsoleRoleCatalog
{
    public const OWNER            = 'owner';
    public const QA_MANAGER       = 'qa_manager';
    public const DEVELOPER_VIEWER = 'developer_viewer';
    public const AUDITOR_VIEWER   = 'auditor_viewer';

    /** Slug => local role code (qa_roles.code). */
    public const SLUG_TO_CODE = [
        self::OWNER            => 'Owner',
        self::QA_MANAGER       => 'QA Manager',
        self::DEVELOPER_VIEWER => 'Developer Viewer',
        self::AUDITOR_VIEWER   => 'Auditor Viewer',
    ];

    /**
     * Role given to a non-superadmin on first sign-in while Console still runs
     * the old payload (no `app_roles`). Never the top role.
     */
    public const LEGACY_DEFAULT = self::DEVELOPER_VIEWER;

    /** @return list<string> */
    public function all(): array
    {
        return array_keys(self::SLUG_TO_CODE);
    }

    public function owner(): string
    {
        return self::OWNER;
    }

    public function legacyDefault(): string
    {
        return self::LEGACY_DEFAULT;
    }

    /**
     * Keep only known slugs, lower-cased, de-duplicated, in catalog order.
     *
     * @param mixed $slugs
     * @return list<string>
     */
    public function normalize(mixed $slugs): array
    {
        if (! is_array($slugs)) {
            return [];
        }

        $wanted = [];
        foreach ($slugs as $slug) {
            if (! is_string($slug)) {
                continue;
            }
            $wanted[strtolower(trim($slug))] = true;
        }

        return array_values(array_filter($this->all(), static fn (string $s): bool => isset($wanted[$s])));
    }
}
