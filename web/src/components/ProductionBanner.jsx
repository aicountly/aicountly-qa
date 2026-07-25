import { envLabel, isProd } from '../lib/format.js'

export default function ProductionBanner({ environment, profileName }) {
  if (!isProd(environment)) return null

  const env = envLabel[environment] || environment
  const target = profileName ? `${env} · ${profileName}` : env

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-center text-xs text-slate-700 sm:px-6">
      <span className="font-medium text-slate-800">Note:</span>
      {' '}You are connected to a production target ({target}).
      {' '}Destructive actions are restricted by the safety guard.
    </div>
  )
}
