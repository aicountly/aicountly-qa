import { Navigate, Route, Routes } from 'react-router-dom'
import Sidebar from './components/Sidebar.jsx'
import Topbar from './components/Topbar.jsx'
import RoleGuard from './components/RoleGuard.jsx'
import { useAuth } from './lib/auth.jsx'

import ControllerGate from './pages/ControllerGate.jsx'
import Dashboard from './pages/Dashboard.jsx'
import TargetProfiles from './pages/TargetProfiles.jsx'
import TargetProfileForm from './pages/TargetProfileForm.jsx'
import NewQaRun from './pages/NewQaRun.jsx'
import SessionPlans from './pages/SessionPlans.jsx'
import QaRuns from './pages/QaRuns.jsx'
import QaRunDetail from './pages/QaRunDetail.jsx'
import ErrorRegister from './pages/ErrorRegister.jsx'
import QaReports from './pages/QaReports.jsx'
import TestDataPacks from './pages/TestDataPacks.jsx'
import ValidationRules from './pages/ValidationRules.jsx'
import Settings from './pages/Settings.jsx'
import AuditLogs from './pages/AuditLogs.jsx'

function Shell({ children }) {
  return (
    <div className="flex h-screen w-screen overflow-hidden bg-neutral-50">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-6">{children}</main>
      </div>
    </div>
  )
}

function Authed({ children, roles }) {
  return (
    <RoleGuard roles={roles}>
      <Shell>{children}</Shell>
    </RoleGuard>
  )
}

export default function App() {
  const { user, loading, ssoPending } = useAuth()

  if (loading || ssoPending) {
    return (
      <div className="grid h-screen place-items-center text-sm text-neutral-500">
        {ssoPending ? 'Signing you in from Console…' : 'Loading QA Portal…'}
      </div>
    )
  }

  if (!user) {
    return <ControllerGate />
  }

  return (
    <Routes>
      <Route path="/login" element={<Navigate to="/" replace />} />

      <Route path="/"                 element={<Authed><Dashboard /></Authed>} />
      <Route path="/target-profiles"  element={<Authed><TargetProfiles /></Authed>} />
      <Route path="/target-profiles/new" element={<Authed roles={['Owner', 'QA Manager']}><TargetProfileForm /></Authed>} />
      <Route path="/target-profiles/:id/edit" element={<Authed roles={['Owner', 'QA Manager']}><TargetProfileForm /></Authed>} />
      <Route path="/new-qa-run"       element={<Authed roles={['Owner', 'QA Manager']}><NewQaRun /></Authed>} />
      <Route path="/session-plans"    element={<Authed><SessionPlans /></Authed>} />
      <Route path="/qa-runs"          element={<Authed><QaRuns /></Authed>} />
      <Route path="/qa-runs/:id"      element={<Authed><QaRunDetail /></Authed>} />
      <Route path="/error-register"   element={<Authed><ErrorRegister /></Authed>} />
      <Route path="/qa-reports"       element={<Authed><QaReports /></Authed>} />
      <Route path="/test-data-packs"  element={<Authed><TestDataPacks /></Authed>} />
      <Route path="/validation-rules" element={<Authed><ValidationRules /></Authed>} />
      <Route path="/settings"         element={<Authed roles={['Owner', 'QA Manager']}><Settings /></Authed>} />
      <Route path="/audit-logs"       element={<Authed><AuditLogs /></Authed>} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
