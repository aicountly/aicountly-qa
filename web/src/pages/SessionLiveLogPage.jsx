import { useParams, useSearchParams } from 'react-router-dom'
import SessionLiveLog from '../components/SessionLiveLog.jsx'

export default function SessionLiveLogPage() {
  const { sessionId } = useParams()
  const [params] = useSearchParams()
  const name = params.get('name') || ''
  const backTo = params.get('from') || ''
  const backLabel = params.get('fromLabel') || 'Back'

  const id = Number(sessionId)
  if (!id) {
    return <div className="text-sm text-red-700">Invalid session id.</div>
  }

  return (
    <div className="-mx-4 -my-4 sm:-mx-6 sm:-my-6" data-fullpage-log>
      <SessionLiveLog
        sessionId={id}
        sessionName={name}
        backTo={backTo || undefined}
        backLabel={backLabel}
      />
    </div>
  )
}
