<?php

namespace Config;

use App\Filters\CorsFilter;
use App\Filters\JwtFilter;
use App\Filters\ProductionGuardFilter;
use App\Filters\RoleFilter;
use App\Filters\WorkerAuthFilter;
use CodeIgniter\Config\Filters as BaseFilters;
use CodeIgniter\Filters\CSRF;
use CodeIgniter\Filters\DebugToolbar;
use CodeIgniter\Filters\ForceHTTPS;
use CodeIgniter\Filters\Honeypot;
use CodeIgniter\Filters\InvalidChars;
use CodeIgniter\Filters\PageCache;
use CodeIgniter\Filters\PerformanceMetrics;
use CodeIgniter\Filters\SecureHeaders;

class Filters extends BaseFilters
{
    public array $aliases = [
        'csrf'          => CSRF::class,
        'toolbar'       => DebugToolbar::class,
        'honeypot'      => Honeypot::class,
        'invalidchars'  => InvalidChars::class,
        'secureheaders' => SecureHeaders::class,
        'forcehttps'    => ForceHTTPS::class,
        'pagecache'     => PageCache::class,
        'performance'   => PerformanceMetrics::class,
        'cors'          => CorsFilter::class,
        'jwt'           => JwtFilter::class,
        'role'          => RoleFilter::class,
        'prod-guard'    => ProductionGuardFilter::class,
        'worker-auth'   => WorkerAuthFilter::class,
    ];

    public array $required = [
        'before' => [
            'forcehttps',
            'pagecache',
        ],
        'after' => [
            'pagecache',
            'performance',

            // Debug Toolbar intentionally disabled for QA API.
            // Keeping this enabled generated writable/debugbar files for
            // every request and caused excessive disk consumption.
            // 'toolbar',
        ],
    ];

    public array $globals = [
        'before' => [
            'cors',
        ],
        'after' => [
            'cors',
            'secureheaders',
        ],
    ];

    public array $methods = [];

    public array $filters = [];
}
