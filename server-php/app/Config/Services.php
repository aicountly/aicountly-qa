<?php

namespace Config;

use App\Libraries\Jwt;
use App\Libraries\RunIdGenerator;
use App\Libraries\Vault;
use App\Services\AuditService;
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
}
