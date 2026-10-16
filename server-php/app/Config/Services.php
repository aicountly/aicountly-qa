<?php

namespace Config;

use App\Libraries\Jwt;
use App\Libraries\RunIdGenerator;
use App\Libraries\Vault;
use App\Models\SettingsModel;
use App\Services\AuditService;
use App\Services\Brain\Adapters\DeterministicAdapter;
use App\Services\Brain\Adapters\GeminiAdapter;
use App\Services\Brain\Adapters\OpenAIAdapter;
use App\Services\Brain\Adapters\PerplexityAdapter;
use App\Services\Brain\BrainEnsemble;
use App\Services\ConsoleAccess\ConsoleRoleSyncService;
use App\Services\ConsoleAccess\ConsoleUserAccessClient;
use App\Services\ConsoleAccess\DbUserRoleStore;
use App\Services\ConsoleIdentityService;
use App\Services\ReportService;
use App\Services\SessionPlannerService;
use App\Services\WorkerStatusService;
use CodeIgniter\Config\BaseService;

class Services extends BaseService
{
    public static function vault(bool $getShared = true): Vault
    {
        if ($getShared) {
            return static::getSharedInstance('vault') ?? static::vault(false);
        }
        return new Vault();
    }

    public static function jwt(bool $getShared = true): Jwt
    {
        if ($getShared) {
            return static::getSharedInstance('jwt') ?? static::jwt(false);
        }
        return new Jwt();
    }

    public static function runId(bool $getShared = true): RunIdGenerator
    {
        if ($getShared) {
            return static::getSharedInstance('runId') ?? static::runId(false);
        }
        return new RunIdGenerator();
    }

    public static function sessionPlanner(bool $getShared = true): SessionPlannerService
    {
        if ($getShared) {
            return static::getSharedInstance('sessionPlanner') ?? static::sessionPlanner(false);
        }
        return new SessionPlannerService();
    }

    public static function reportService(bool $getShared = true): ReportService
    {
        if ($getShared) {
            return static::getSharedInstance('reportService') ?? static::reportService(false);
        }
        return new ReportService();
    }

    public static function auditService(bool $getShared = true): AuditService
    {
        if ($getShared) {
            return static::getSharedInstance('auditService') ?? static::auditService(false);
        }
        return new AuditService();
    }

    public static function workerStatus(bool $getShared = true): WorkerStatusService
    {
        if ($getShared) {
            return static::getSharedInstance('workerStatus') ?? static::workerStatus(false);
        }
        return new WorkerStatusService();
    }

    public static function consoleIdentity(bool $getShared = true): ConsoleIdentityService
    {
        if ($getShared) {
            return static::getSharedInstance('consoleIdentity') ?? static::consoleIdentity(false);
        }
        return new ConsoleIdentityService();
    }

    /**
     * Console-assigned roles: login sync, refresh pull and per-request re-check.
     * QA_CONSOLE_RECHECK_MINUTES (default 15) bounds how stale local roles may get.
     */
    public static function consoleRoleSync(bool $getShared = true): ConsoleRoleSyncService
    {
        if ($getShared) {
            return static::getSharedInstance('consoleRoleSync') ?? static::consoleRoleSync(false);
        }

        $cache = null;
        try {
            $cache = static::cache();
        } catch (\Throwable) {
            $cache = null;
        }

        return new ConsoleRoleSyncService(
            new DbUserRoleStore(),
            new ConsoleUserAccessClient(),
            null,
            $cache,
            null,
            max(60, (int) env('QA_CONSOLE_RECHECK_MINUTES', 15) * 60),
        );
    }

    public static function brain(bool $getShared = true): BrainEnsemble
    {
        if ($getShared) {
            return static::getSharedInstance('brain') ?? static::brain(false);
        }
        return new BrainEnsemble(
            new OpenAIAdapter(),
            new PerplexityAdapter(),
            new GeminiAdapter(),
            new DeterministicAdapter(),
            new SettingsModel(),
        );
    }
}
