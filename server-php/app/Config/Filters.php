<?php

namespace Config;

use App\Filters\CorsFilter;
use App\Filters\JwtFilter;
use App\Filters\ProductionGuardFilter;
use App\Filters\RoleFilter;
use App\Filters\WorkerAuthFilter;
use CodeIgniter\Config\BaseConfig;
use CodeIgniter\Filters\CSRF;
use CodeIgniter\Filters\DebugToolbar;
use CodeIgniter\Filters\Honeypot;
use CodeIgniter\Filters\InvalidChars;
use CodeIgniter\Filters\SecureHeaders;

class Filters extends BaseConfig
{
    public array $aliases = [
        'csrf'          => CSRF::class,
        'toolbar'       => DebugToolbar::class,
        'honeypot'      => Honeypot::class,
        'invalidchars'  => InvalidChars::class,
        'secureheaders' => SecureHeaders::class,
        'cors'          => CorsFilter::class,
        'jwt'           => JwtFilter::class,
        'role'          => RoleFilter::class,
        'prod-guard'    => ProductionGuardFilter::class,
        'worker-auth'   => WorkerAuthFilter::class,
    ];

    public array $globals = [
        'before' => [
            'cors',
        ],
        'after' => [
            'cors',
            'toolbar',
            'secureheaders',
        ],
    ];

    public array $methods = [];

    public array $filters = [];
}
