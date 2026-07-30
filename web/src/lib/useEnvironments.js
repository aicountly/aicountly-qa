import { useQuery } from '@tanstack/react-query'
import { api, v1 } from './api.js'
import { ENVIRONMENTS, mergeEnvironmentRows } from './environments.js'

/**
 * Environment tiers for select inputs. Prefers `GET /v1/environments` and falls
 * back to the local constants when that endpoint is not deployed yet.
 */
export function useEnvironments() {
  const { data } = useQuery({
    queryKey: ['environments'],
    queryFn: async () => {
      try {
        const res = await api.get(v1('/environments'))
        return mergeEnvironmentRows(res.data?.data)
      } catch {
        return ENVIRONMENTS
      }
    },
    staleTime: 10 * 60_000,
    retry: false,
  })

  return data && data.length > 0 ? data : ENVIRONMENTS
}
