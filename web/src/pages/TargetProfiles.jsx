import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api, v1 } from '../lib/api.js'
import { EnvBadge, StatusBadge } from '../components/Badges.jsx'
import { useAuth } from '../lib/auth.jsx'
import { productLabel } from '../lib/products.js'
import { isObserverOnlyEnvironment } from '../lib/environments.js'

function YesNo({ on, yes = 'allowed', no = 'blocked', title }) {
  return (
    <span
      className={`qa-badge ${on ? 'bg-aicountly-50 text-aicountly-700' : 'bg-neutral-100 text-neutral-600'}`}
      title={title}
    >
      {on ? yes : no}
    </span>
  )
}

export default function TargetProfiles() {
  const qc = useQueryClient()
  const { hasRole } = useAuth()
  const canEdit = hasRole(['Owner', 'QA Manager'])
  const canDelete = hasRole(['Owner'])
  const showActions = canEdit || canDelete
  const colSpan = showActions ? 10 : 9

  const { data, isLoading } = useQuery({
    queryKey: ['target-profiles'],
    queryFn: async () => (await api.get(v1('/target-profiles'))).data?.data ?? [],
  })

  const remove = useMutation({
    mutationFn: async (id) => api.delete(v1(`/target-profiles/${id}`)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['target-profiles'] }),
  })

  function handleDelete(profile) {
    if (!window.confirm(
      `Delete target profile "${profile.profile_name}"?\n\nThis removes the profile and its stored credentials. This cannot be undone.`,
    )) return
    remove.mutate(profile.id)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-neutral-600">
          Approved AICOUNTLY target apps the QA bot may sign into, with the safety guard that applies to
          each one. Credentials are stored encrypted (AES-256-GCM).
        </p>
        {canEdit && (
          <Link to="/target-profiles/new" className="qa-btn-primary shrink-0">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4"><path d="M12 4v16m8-8H4" /></svg>
            New Target Profile
          </Link>
        )}
      </div>

      <div className="qa-card overflow-x-auto p-0">
        <table className="qa-table">
          <thead>
            <tr>
              <th>Profile</th>
              <th>Product</th>
              <th>Environment</th>
              <th>Credentials</th>
              <th>Base URL</th>
              <th title="How the worker signs in, and how much a session may do">Login / mode</th>
              <th>Data creation</th>
              <th title="Synthetic file upload / download round-trips">File round-trips</th>
              <th>Status</th>
              {showActions && <th></th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={colSpan} className="px-3 py-4 text-neutral-500">Loading…</td></tr>}
            {(data || []).map((p) => {
              const observerLocked = isObserverOnlyEnvironment(p.environment)
              const observer = observerLocked || p.observer_mode || p.read_only
              const dataCreation = !observerLocked && !!p.data_creation_allowed
              const fileActions = !observerLocked && !!p.allow_safe_demo
              return (
                <tr key={p.id}>
                  <td>
                    <div className="font-medium text-neutral-900">{p.profile_name}</div>
                    {observer && (
                      <span
                        className="mt-0.5 inline-block qa-badge bg-neutral-100 text-neutral-600"
                        title={observerLocked
                          ? 'Observer-only environment: writes are never permitted'
                          : 'Observer flags are enabled on this profile'}
                      >
                        observer
                      </span>
                    )}
                  </td>
                  <td>{productLabel(p.product_name)}</td>
                  <td><EnvBadge environment={p.environment} /></td>
                  <td>
                    {p.has_credentials
                      ? <span className="qa-badge bg-aicountly-100 text-aicountly-800">set</span>
                      : (
                        <span className="qa-badge bg-amber-100 text-amber-900" title="Worker cannot log in until a password is saved">
                          missing
                        </span>
                      )}
                  </td>
                  <td className="text-xs text-neutral-500">{p.base_url}</td>
                  <td className="text-xs text-neutral-600">
                    <div>{p.login_strategy || 'standard'}</div>
                    <div className="text-neutral-500">
                      {p.execution_mode || 'full'}
                      {p.jump_to ? ` · jump: ${p.jump_to}` : ''}
                    </div>
                  </td>
                  <td>
                    <YesNo
                      on={dataCreation}
                      title={observerLocked
                        ? 'Blocked: observer-only environment'
                        : 'Whether sessions may create deterministic test records'}
                    />
                  </td>
                  <td>
                    <YesNo
                      on={fileActions}
                      yes="safe demo on"
                      no="off"
                      title={observerLocked
                        ? 'Blocked: observer-only environment'
                        : 'Allow safe demo is required for synthetic upload/download verification'}
                    />
                  </td>
                  <td><StatusBadge status={p.status} /></td>
                  {showActions && (
                    <td className="space-x-3 text-right">
                      {canEdit && (
                        <Link to={`/target-profiles/${p.id}/edit`} className="text-sm text-aicountly-700 hover:underline">Edit</Link>
                      )}
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => handleDelete(p)}
                          disabled={remove.isPending}
                          className="text-sm text-red-600 hover:underline disabled:opacity-50"
                        >
                          Delete
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
            {!isLoading && (data || []).length === 0 && (
              <tr><td colSpan={colSpan} className="px-3 py-4 text-neutral-500">No target profiles yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
