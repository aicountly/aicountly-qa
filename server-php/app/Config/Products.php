<?php

namespace Config;

use CodeIgniter\Config\BaseConfig;

class Products extends BaseConfig
{
    /** Canonical SaaS product slugs shared with smoke target-profile selection. */
    public array $catalog = [
        'contacts', 'my-account', 'books', 'calendar', 'docs', 'chat',
        'auditor', 'fr', 'secretarial', 'vault', 'hrms', 'ourpeople', 'buddy',
    ];
}
