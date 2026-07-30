import {
  environmentLabel,
  isObserverOnlyEnvironment,
  isProductionEnvironment,
} from '../lib/environments.js'

export default function ProductionBanner({ environment, profileName }) {
  if (!isProductionEnvironment(environment)) return null

  const env = environmentLabel(environment)
  const target = profileName ? `${env} · ${profileName}` : env
  const observerOnly = isObserverOnlyEnvironment(environment)

  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-center text-xs text-red-900">
      <span className="font-semibold">Live production target</span>
      {' — '}
      {target}.
      {' '}
      {observerOnly
        ? 'Observer-only: the worker reads and verifies data but never creates, edits, uploads or deletes anything.'
        : 'Full access: data creation and synthetic file upload/download round-trips are permitted. The safety guard still blocks deletes outside allowed modules.'}
    </div>
  )
}
