import { useQuery } from '@tanstack/react-query'
import { api, v1 } from '../lib/api.js'

export default function TestDataPacks() {
  const { data, isLoading } = useQuery({
    queryKey: ['test-data-packs'],
    queryFn: async () => (await api.get(v1('/test-data-packs'))).data?.data ?? [],
  })

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Deterministic data packs the QA bot enters into target apps. Each row in the pack is tagged with the QA run ID so cleanup is safe.
      </p>
      {isLoading && <div className="text-sm text-neutral-500">Loading…</div>}
      {(data || []).map((p) => <PackCard key={p.id} pack={p} />)}
    </div>
  )
}

function PackCard({ pack }) {
  return (
    <div className="qa-card">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-neutral-900">{pack.pack_name}</div>
          <div className="text-xs text-neutral-500">{pack.product_name} · v{pack.version} · {pack.module}</div>
        </div>
        <span className={`qa-badge ${pack.is_active ? 'bg-aicountly-100 text-aicountly-800' : 'bg-neutral-100 text-neutral-700'}`}>
          {pack.is_active ? 'active' : 'inactive'}
        </span>
      </div>
      <p className="mt-1 text-xs text-neutral-600">{pack.description}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs text-aicountly-700">View data JSON</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-neutral-900 p-3 text-[11px] text-neutral-100">
{JSON.stringify(pack.data_json, null, 2)}
        </pre>
      </details>
    </div>
  )
}
