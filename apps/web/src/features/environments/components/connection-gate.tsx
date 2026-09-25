import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { RingLoader } from '@workspace/ui/components/ring-loader'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'

import { clientForQueryClient, originForQueryClient } from '@/lib/environments/state/query-clients'
import { selectServerConnection } from '@workspace/client-core/environments/state/store'
import { useEnvironmentsStore } from '@/lib/environments/state/store'
import { readEnvironmentDescriptor } from '@/lib/environments/utils/descriptor'
import { toClientError } from '@/lib/client-error-taxonomy'
import { InlineError } from '@/components/inline-error'

export function ConnectionGate({
  origin,
  children,
}: {
  readonly origin: string
  readonly children: ReactNode
}) {
  const known = useEnvironmentsStore(
    (state) =>
      state.entries[origin]?.descriptor !== null && Boolean(state.entries[origin]?.environmentId),
  )
  const connection = useEnvironmentsStore((state) => selectServerConnection(state, origin))
  const query = useQuery({
    queryKey: environmentQueryKeys.descriptor,
    networkMode: 'always',
    queryFn: ({ client, signal }) =>
      readEnvironmentDescriptor(originForQueryClient(client), signal, clientForQueryClient(client)),
    retry: false,
  })
  if (known) return children
  const refused = connection.phase === 'identity-drift' || connection.phase === 'protocol-mismatch'
  if (refused || (query.isError && !query.data)) {
    return (
      <div className='bg-background text-foreground grid min-h-svh place-content-center gap-4 p-8'>
        <InlineError
          message={
            refused
              ? 'This server’s identity or protocol has changed. Reconnect the original server.'
              : toClientError(query.error).message
          }
          title='Server connection'
        />
        <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? <OrbitLoader /> : null} Retry connection
        </Button>
      </div>
    )
  }
  if (query.isPending) {
    return (
      <div
        role='status'
        className='bg-background text-foreground grid min-h-svh place-content-center gap-3'
      >
        <RingLoader className='mx-auto size-8' />
        <p className='text-sm'>Connecting to server…</p>
      </div>
    )
  }
  return children
}
