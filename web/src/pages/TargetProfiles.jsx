import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, StatusBadge } from '../components/Badges.jsx'
import { useAuth } from '../lib/auth.jsx'

export default function TargetProfiles() {
  const { hasRole } = useAuth()
  const canEdit = hasRole(['Owner', 'QA Manager'])

  const { data, isLoading } = useQuery({
    queryKey: ['target-profiles'],
    queryFn: async () => (await api.get(v1('/target-profiles'))).data?.data ?? [],
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-neutral-600">
          Approved AICOUNTLY target apps the QA bot is allowed to log into. Credentials are stored encrypted (AES-256-GCM).
        </p>
        {canEdit && (
          <Link to="/target-profiles/new" className="qa-btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 4v16m8-8H4" /></svg>
            New Target Profile
          </Link>
        )}
      </div>

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr>
              <th>Profile</th><th>Product</th><th>Environment</th><th>Base URL</th><th>Data Creation</th><th>Status</th>
              {canEdit && <th></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="px-3 py-4 text-neutral-500">Loading…</td></tr>}
            {(data || []).map((p) => (
              <tr key={p.id}>
                <td className="font-medium text-neutral-900">{p.profile_name}</td>
                <td>{p.product_name}</td>
                <td><EnvBadge environment={p.environment} /></td>
                <td className="text-xs text-neutral-500">{p.base_url}</td>
                <td>
                  {p.data_creation_allowed
                    ? <span className="qa-badge bg-aicountly-50 text-aicountly-700">allowed</span>
                    : <span className="qa-badge bg-neutral-100 text-neutral-600">blocked</span>}
                </td>
                <td><StatusBadge status={p.status} /></td>
                {canEdit && (
                  <td className="text-right">
                    <Link to={`/target-profiles/${p.id}/edit`} className="text-aicountly-700 hover:underline text-sm">Edit</Link>
                  </td>
                )}
              </tr>
            ))}
            {!isLoading && (data || []).length === 0 && (
              <tr><td colSpan={7} className="px-3 py-4 text-neutral-500">No target profiles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
