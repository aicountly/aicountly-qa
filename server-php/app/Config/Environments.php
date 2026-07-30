<?php

namespace Config;

/**
 * Target environment safety tiers (aligned with the smoke portal).
 *
 * Every tier that points at a live system is "production" for labelling, but
 * only the observer-only tiers strip destructive permission. `production_full_access`
 * is a live target the owner controls, so it keeps the production banner while
 * allowing the same actions as a sandbox.
 *
 * Never test a tier with str_starts_with($env, 'production') — that would sweep
 * production_full_access into the observer-only rules it is meant to opt out of.
 */
class Environments
{
    public const SANDBOX = 'sandbox';
    public const GH_STAGING = 'gh_staging';
    public const PRODUCTION_READONLY = 'production_readonly';
    public const PRODUCTION_RESTRICTED = 'production_restricted';
    public const PRODUCTION_FULL_ACCESS = 'production_full_access';

    /** @var list<string> */
    public const ALL = [
        self::SANDBOX,
        self::GH_STAGING,
        self::PRODUCTION_READONLY,
        self::PRODUCTION_RESTRICTED,
        self::PRODUCTION_FULL_ACCESS,
    ];

    public const DEFAULT = self::SANDBOX;

    /** Live targets, for banners and red badges. */
    private const PRODUCTION = [
        self::PRODUCTION_READONLY,
        self::PRODUCTION_RESTRICTED,
        self::PRODUCTION_FULL_ACCESS,
    ];

    /** Live targets that may never click a restricted label or touch files. */
    private const OBSERVER_ONLY = [
        self::PRODUCTION_READONLY,
        self::PRODUCTION_RESTRICTED,
    ];

    /** Tiers where destructive actions and file mutations may be opted into. */
    private const FULL_ACCESS = [
        self::SANDBOX,
        self::GH_STAGING,
        self::PRODUCTION_FULL_ACCESS,
    ];

    /**
     * Legacy QA values still present in older rows / older worker builds.
     *
     * @var array<string, string>
     */
    public const LEGACY_MAP = [
        'gh'         => self::GH_STAGING,
        'prod_basic' => self::PRODUCTION_READONLY,
        'prod_full'  => self::PRODUCTION_FULL_ACCESS,
    ];

    /** @var array<string, string> */
    private const LABELS = [
        self::SANDBOX                => 'Sandbox',
        self::GH_STAGING             => 'GH Staging',
        self::PRODUCTION_READONLY    => 'Production (read only)',
        self::PRODUCTION_RESTRICTED  => 'Production (restricted)',
        self::PRODUCTION_FULL_ACCESS => 'Production (full access)',
    ];

    /** @var array<string, string> */
    private const DESCRIPTIONS = [
        self::SANDBOX                => 'Disposable QA data. Every check, including synthetic file uploads, is allowed.',
        self::GH_STAGING             => 'Shared staging build. Behaves like sandbox for permissions.',
        self::PRODUCTION_READONLY    => 'Live data, observer only. Login plus read-only navigation and report loads.',
        self::PRODUCTION_RESTRICTED  => 'Live data, observer only with tighter module scoping. No writes, no file actions.',
        self::PRODUCTION_FULL_ACCESS => 'Live data the owner controls. Same permissions as sandbox, still flagged as production.',
    ];

    /** Canonicalise an incoming value, translating legacy QA tiers. */
    public static function normalize(?string $environment): string
    {
        $value = strtolower(trim((string) $environment));
        if ($value === '') {
            return self::DEFAULT;
        }

        return self::LEGACY_MAP[$value] ?? $value;
    }

    public static function isKnown(?string $environment): bool
    {
        return in_array(self::normalize($environment), self::ALL, true);
    }

    /**
     * Legacy keys that map onto a canonical tier, for reading step templates and
     * settings authored before the rename.
     *
     * @return list<string>
     */
    public static function legacyAliases(string $canonical): array
    {
        return array_keys(array_filter(
            self::LEGACY_MAP,
            static fn (string $target): bool => $target === $canonical
        ));
    }

    /**
     * Keys to try, in order, when reading a template's steps_by_env block.
     * Observer tiers fall back to the read-only steps so a newly added tier is
     * never silently given the full-access script.
     *
     * @return list<string>
     */
    public static function templateKeys(?string $environment): array
    {
        $canonical = self::normalize($environment);
        $keys      = array_merge([$canonical], self::legacyAliases($canonical));

        if (self::isObserverOnly($canonical)) {
            $keys[] = self::PRODUCTION_READONLY;
            $keys[] = 'prod_basic';
        } elseif (self::isProduction($canonical)) {
            $keys[] = 'prod_full';
        }

        return array_values(array_unique($keys));
    }

    public static function isProduction(?string $environment): bool
    {
        return in_array(self::normalize($environment), self::PRODUCTION, true);
    }

    /**
     * True when the tier forces observer mode: read_only and observer_mode are
     * pinned on, allow_safe_demo and data creation are pinned off.
     */
    public static function isObserverOnly(?string $environment): bool
    {
        return in_array(self::normalize($environment), self::OBSERVER_ONLY, true);
    }

    /** True when the tier may opt into destructive actions and file mutations. */
    public static function allowsFullAccess(?string $environment): bool
    {
        return in_array(self::normalize($environment), self::FULL_ACCESS, true);
    }

    /** Synthetic data entry (ledgers, vouchers, masters) is only possible off observer tiers. */
    public static function allowsDataCreation(?string $environment): bool
    {
        return ! self::isObserverOnly($environment);
    }

    /** Uploads / imports / exports that mutate the target are observer-forbidden. */
    public static function allowsFileActions(?string $environment): bool
    {
        return ! self::isObserverOnly($environment);
    }

    public static function label(?string $environment): string
    {
        return self::LABELS[self::normalize($environment)] ?? (string) $environment;
    }

    public static function description(?string $environment): string
    {
        return self::DESCRIPTIONS[self::normalize($environment)] ?? '';
    }

    /**
     * Machine-readable catalogue served by GET /api/v1/environments.
     *
     * @return list<array{
     *     value:string,label:string,description:string,is_production:bool,
     *     observer_only:bool,allows_data_creation:bool,allows_file_actions:bool
     * }>
     */
    public static function catalog(): array
    {
        $out = [];
        foreach (self::ALL as $value) {
            $out[] = [
                'value'                => $value,
                'label'                => self::label($value),
                'description'          => self::description($value),
                'is_production'        => self::isProduction($value),
                'observer_only'        => self::isObserverOnly($value),
                'allows_data_creation' => self::allowsDataCreation($value),
                'allows_file_actions'  => self::allowsFileActions($value),
            ];
        }

        return $out;
    }
}
