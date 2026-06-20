/**
 * AICOUNTLY SaaS product slugs (stored as product_name on target profiles / runs).
 * Labels match my.aicountly.com app launcher where applicable.
 */
export const SAAS_PRODUCTS = [
  { value: 'books', label: 'Smart Books' },
  { value: 'my', label: 'My Account' },
  { value: 'manage', label: 'Manage' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'fr', label: 'Financial Reporting' },
  { value: 'secretarial', label: 'Secretarial' },
  { value: 'hrms', label: 'HRMS' },
  { value: 'vault', label: 'Vault' },
  { value: 'contacts', label: 'Contacts' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'docs', label: 'Docs' },
  { value: 'chat', label: 'Chat' },
]

/** For FilterBar: { value, label } with optional "All" handled by FilterBar */
export const PRODUCT_FILTER_OPTIONS = SAAS_PRODUCTS.map((p) => ({
  value: p.value,
  label: p.label,
}))

export function productLabel(slug) {
  const hit = SAAS_PRODUCTS.find((p) => p.value === slug)
  return hit?.label ?? slug
}
