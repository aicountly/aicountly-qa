import { useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth.jsx'
import AppLauncher from './AppLauncher.jsx'

const titles = {
  '/': 'Dashboard',
  '/target-profiles': 'Target App Profiles',
  '/new-qa-run': 'New QA Run',
  '/session-plans': 'Session Plans',
  '/qa-runs': 'QA Runs',
  '/error-register': 'Error Register',
  '/qa-reports': 'QA Reports',
  '/test-data-packs': 'Test Data Packs',
  '/validation-rules': 'Validation Rules',
  '/settings': 'Settings',
  '/audit-logs': 'Audit Logs',
}

export default function Topbar() {
  const { pathname } = useLocation()
  const { user } = useAuth()
  const title = titles[pathname] || titles[Object.keys(titles).find((k) => k !== '/' && pathname.startsWith(k))] || 'AICOUNTLY QA'

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-neutral-200 bg-white/95 px-4 backdrop-blur sm:px-6">
      <div>
        <h1 className="text-sm font-semibold text-neutral-900">{title}</h1>
        <p className="text-xs text-neutral-500">Internal QA Testing Agent — testing &amp; reporting only</p>
      </div>
      <div className="flex items-center gap-3">
        <AppLauncher />
        <div className="hidden text-right text-xs text-neutral-500 sm:block">
        {user?.email}
        <div className="text-aicountly-700 font-medium">{(user?.roles || []).join(' · ')}</div>
        </div>
      </div>
    </header>
  )
}
