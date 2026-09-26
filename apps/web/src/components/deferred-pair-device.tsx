import { queryOptions, useQuery } from '@tanstack/react-query'
import { StatusFrame } from '@workspace/ui/patterns/status-frame'

import { ModuleLoadError } from '@/components/module-load-error'
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
  if (query.isPending) return <StatusFrame title='Connecting to local machine…' tone='pending' />
  if (query.isError)
    return (
      <ModuleLoadError
        className='min-h-svh'
        label='the pairing screen'
        onRetry={() => void query.refetch()}
      />
    )

  const { PairDevice } = query.data
  return <PairDevice onPaired={onPaired} />
}
