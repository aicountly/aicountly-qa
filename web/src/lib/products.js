/**
 * AICOUNTLY SaaS product slugs (stored as product_name on target profiles / runs).
 * Canonical catalog aligned with smoke.aicountly.org.
 */
export const SAAS_PRODUCTS = [
  { value: 'contacts', label: 'Contacts' },
  { value: 'my-account', label: 'My Account' },
  { value: 'books', label: 'Smart Books' },
  { value: 'calendar', label: 'Calendar' },
  { value: 'docs', label: 'Docs' },
  { value: 'chat', label: 'Chat' },
  { value: 'auditor', label: 'Auditor' },
  { value: 'fr', label: 'Financial Reporting' },
  { value: 'secretarial', label: 'Secretarial' },
  { value: 'vault', label: 'Vault' },
  { value: 'hrms', label: 'HRMS' },
  { value: 'ourpeople', label: 'Our People' },
  { value: 'buddy', label: 'Buddy' },
]

/** Legacy slugs still present on older target profiles / filter URLs. */
const LEGACY_PRODUCT_LABELS = {
  my: 'My Account',
  manage: 'Manage',
}

/** Map removed smoke-era slugs to the canonical catalog value. */
const LEGACY_PRODUCT_SLUGS = {
  my: 'my-account',
  manage: 'my-account',
}

/** For FilterBar: { value, label } with optional "All" handled by FilterBar */
export const PRODUCT_FILTER_OPTIONS = SAAS_PRODUCTS.map((p) => ({
  value: p.value,
  label: p.label,
}))

export function canonicalizeProductSlug(slug) {
  if (!slug) return slug
  return LEGACY_PRODUCT_SLUGS[slug] || slug
}

export function productLabel(slug) {
  const canonical = canonicalizeProductSlug(slug)
  const hit = SAAS_PRODUCTS.find((p) => p.value === canonical)
  if (hit) return hit.label
  if (slug && LEGACY_PRODUCT_LABELS[slug]) return LEGACY_PRODUCT_LABELS[slug]
  return slug
}
