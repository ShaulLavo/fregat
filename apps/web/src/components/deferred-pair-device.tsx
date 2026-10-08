import { queryOptions, useQuery } from '@tanstack/react-query'
import { StatusFrame } from '@workspace/ui/patterns/status-frame'

import { ModuleLoadError } from '@/components/module-load-error'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { pairingStatusQueryOptions } from '@/lib/pairing/utils/api'
import { resourceQueryClient } from '@/lib/resources/state/query-client'

// Only an unpaired device ever sees the screen, so its code stays out of everyone's first load.
const pairDeviceQueryOptions = queryOptions({
  queryKey: ['pairing', 'screen-module'],
  queryFn: () => import('@/components/pair-device'),
  staleTime: 'static',
  structuralSharing: false,
  gcTime: Infinity,
  networkMode: 'always',
})

export function DeferredPairDevice({ onPaired }: { readonly onPaired: () => void }) {
  const query = useQuery(pairDeviceQueryOptions, resourceQueryClient)
  // Loads beside the module so the screen paints once, with the machine's name in it.
  const status = useQuery(pairingStatusQueryOptions(), primaryQueryClient())
  if (query.isPending || status.isPending)
    return <StatusFrame title='Connecting to local machine…' tone='pending' />
  if (query.isError)
    return (
      <ModuleLoadError
        className='min-h-svh'
        label='the pairing screen'
        onRetry={() => void query.refetch()}
      />
    )

  const { PairDevice } = query.data
  return <PairDevice machine={status.data?.machine ?? null} onPaired={onPaired} />
}
