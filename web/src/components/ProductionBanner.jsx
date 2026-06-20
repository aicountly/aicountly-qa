import { envLabel, isProd } from '../lib/format.js'

export default function ProductionBanner({ environment, profileName }) {
  if (!isProd(environment)) return null
  return (
    <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-center text-xs font-semibold text-red-800 sm:px-6">
      PRODUCTION TARGET ACTIVE — {envLabel[environment] || environment}
      {profileName ? <span className="ml-2 text-red-700/80">({profileName})</span> : null}
      <span className="ml-2 font-normal text-red-700/70">All destructive actions are blocked by safeActionGuard.</span>
    </div>
  )
}
