import { useQueryClient } from '@tanstack/react-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

/** This environment's server accepted a Restart and has not come back yet: offline is expected. */
export function useServerRestarting() {
  const origin = originForQueryClient(useQueryClient())
  return useEnvironmentsStore((state) => state.updateByOrigin[origin]?.phase === 'restarting')
}
