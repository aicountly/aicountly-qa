import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

export default function RoleGuard({ children, roles }) {
  const { user, loading, hasRole } = useAuth()
  const loc = useLocation()

  if (loading) {
    return <div className="p-6 text-sm text-neutral-500">Loading…</div>
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }
  if (roles && !hasRole(roles)) {
    return (
      <div className="p-6">
        <div className="qa-card">
          <h2 className="text-base font-semibold text-red-700">Forbidden</h2>
          <p className="mt-1 text-sm text-neutral-600">
            This page requires one of these roles: <strong>{roles.join(', ')}</strong>.
          </p>
        </div>
      </div>
    )
  }
  return children
}
