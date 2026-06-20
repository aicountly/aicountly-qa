import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'

const nav = [
  { to: '/',                 label: 'Dashboard',          icon: 'M3 12l9-9 9 9M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10' },
  { to: '/target-profiles',  label: 'Target App Profiles', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/new-qa-run',       label: 'New QA Run',         icon: 'M12 4v16m8-8H4' },
  { to: '/session-plans',    label: 'Session Plans',      icon: 'M9 5h6l1 2h3v14H5V7h3z' },
  { to: '/qa-runs',          label: 'QA Runs',            icon: 'M5 12h14M12 5l7 7-7 7' },
  { to: '/error-register',   label: 'Error Register',     icon: 'M12 9v2m0 4h.01M5 19h14a2 2 0 0 0 1.7-3l-7-12a2 2 0 0 0-3.4 0l-7 12A2 2 0 0 0 5 19z' },
  { to: '/qa-reports',       label: 'QA Reports',         icon: 'M9 17v-6h13M9 11V5h13M3 7h4M3 13h4M3 19h4' },
  { to: '/test-data-packs',  label: 'Test Data Packs',    icon: 'M4 7h16M4 12h16M4 17h10' },
  { to: '/validation-rules', label: 'Validation Rules',   icon: 'M5 13l4 4L19 7' },
  { to: '/settings',         label: 'Settings',           icon: 'M10.3 3.6a1 1 0 0 1 1.4 0l1 1a1 1 0 0 0 1 .2l1.4-.3a1 1 0 0 1 1.2.7l.4 1.3a1 1 0 0 0 .7.7l1.3.4a1 1 0 0 1 .7 1.2l-.3 1.4a1 1 0 0 0 .2 1l1 1a1 1 0 0 1 0 1.4l-1 1a1 1 0 0 0-.2 1l.3 1.4a1 1 0 0 1-.7 1.2l-1.3.4a1 1 0 0 0-.7.7l-.4 1.3a1 1 0 0 1-1.2.7l-1.4-.3a1 1 0 0 0-1 .2l-1 1a1 1 0 0 1-1.4 0l-1-1a1 1 0 0 0-1-.2l-1.4.3a1 1 0 0 1-1.2-.7l-.4-1.3a1 1 0 0 0-.7-.7l-1.3-.4a1 1 0 0 1-.7-1.2l.3-1.4a1 1 0 0 0-.2-1l-1-1a1 1 0 0 1 0-1.4l1-1a1 1 0 0 0 .2-1L3.4 9a1 1 0 0 1 .7-1.2l1.3-.4a1 1 0 0 0 .7-.7l.4-1.3A1 1 0 0 1 7.7 4.5l1.4.3a1 1 0 0 0 1-.2l1-1zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z' },
  { to: '/audit-logs',       label: 'Audit Logs',         icon: 'M5 4h14a1 1 0 0 1 1 1v15l-4-2-4 2-4-2-4 2V5a1 1 0 0 1 1-1z' },
]

export default function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="hidden lg:flex w-60 shrink-0 flex-col border-r border-neutral-200 bg-white">
      <div className="flex h-14 items-center gap-2 border-b border-neutral-200 px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-aicountly-600 text-xs font-bold text-white">QA</span>
        <div className="text-sm">
          <div className="font-semibold text-neutral-900 leading-tight">AICOUNTLY QA</div>
          <div className="text-xs text-neutral-500 leading-tight">qa.aicountly.org</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-0.5">
        {nav.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition
              ${isActive
                ? 'bg-aicountly-50 text-aicountly-700'
                : 'text-neutral-700 hover:bg-neutral-50 hover:text-neutral-900'}`
            }
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0">
              <path d={n.icon} />
            </svg>
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-neutral-200 p-3">
        <div className="text-xs text-neutral-500 mb-2">
          {user?.email}
          <div className="text-aicountly-700 font-medium mt-0.5">
            {(user?.roles || []).join(' · ')}
          </div>
        </div>
        <button
          type="button"
          onClick={logout}
          className="qa-btn-secondary w-full justify-center text-xs"
        >
          Sign out
        </button>
      </div>
    </aside>
  )
}
