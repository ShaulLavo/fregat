import { useQuery, useQueryClient } from '@tanstack/react-query'

import { machineLocalOptions } from '@/features/chat/utils/machine-local-query'
import { originForQueryClient } from '@/lib/environments/state/query-clients'
import { useEnvironmentsStore } from '@/lib/environments/state/store'

/**
 * Whether to offer files from the machine the composer drafts on, named when it has a name.
 * The browser's own file dialog already browses that machine when this device verifiably is it,
 * so the offer goes everywhere else, including wherever locality cannot be checked. A caller that
 * takes no machine files passes `wanted` false, and nothing is checked.
 */
export function useMachineAttachOffer(wanted: boolean) {
  const queryClient = useQueryClient()
  const label = useEnvironmentsStore(
    (state) => state.entries[originForQueryClient(queryClient)]?.label ?? null,
  )
  const local = useQuery({ ...machineLocalOptions(queryClient), enabled: wanted })
  // Only a verified local desktop withholds the offer; pending and failed checks offer it.
  if (!wanted || local.data === true) return null

  return { label }
}
