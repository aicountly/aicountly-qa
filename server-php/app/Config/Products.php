<?php

namespace Config;

use CodeIgniter\Config\BaseConfig;

class Products extends BaseConfig
{
    /** Canonical SaaS product slugs shared with target-profile selection. */
    public array $catalog = [
        'contacts', 'my-account', 'books', 'calendar', 'docs', 'chat',
        'auditor', 'fr', 'secretarial', 'vault', 'hrms', 'ourpeople', 'buddy',
    ];

    /**
     * Ordered labels accepted by the my.aicountly.com Jump To dropdown.
     *
     * These are worker hints, not a replacement for reading the live options.
     * Keeping them product-scoped prevents a shared worker from silently sending
     * a non-Books QA profile to the Books application.
     *
     * @var array<string, list<string>>
     */
    public array $jumpTargets = [
        'contacts'    => ['Contacts'],
        'my-account'  => ['My Account'],
        'books'       => ['Smart Books', 'Books'],
        'calendar'    => ['Calendar'],
        'docs'        => ['Docs', 'Documents'],
        'chat'        => ['Chat'],
        'auditor'     => ['Auditor'],
        'fr'          => ['Financial Reporting', 'FR'],
        'secretarial' => ['Secretarial'],
        'vault'       => ['Vault'],
        'hrms'        => ['HRMS'],
        'ourpeople'   => ['Our People', 'OurPeople', 'HRMS'],
        'buddy'       => ['Buddy'],
    ];

    /** @return list<string> */
    public function jumpTargetsFor(string $product): array
    {
        $slug = strtolower(trim($product));

        return $this->jumpTargets[$slug] ?? ($slug !== '' ? [$product] : []);
    }
}
