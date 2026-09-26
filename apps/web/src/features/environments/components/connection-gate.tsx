import { refusalMessage } from '@/features/environments/utils/refusal-message'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { environmentMutationKeys } from '@/lib/environments/utils/mutation-keys'
import { primaryServerOrigin } from '@/lib/client'
import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { useMutation, useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'

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
  const connections = useEnvironmentConnections()
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
  const machine = connections.machines.find((machine) => machine.origin === origin)
  const retry = useMutation({
    mutationKey: environmentMutationKeys.machine('connect', machine?.name ?? '@primary'),
    scope: { id: `environment-retry:${origin}` },
    mutationFn: async () => {
      if (origin === primaryServerOrigin()) await connections.retryPrimary()
      else if (machine) await connections.retryMachine(machine.name)
      await query.refetch()
    },
  })
  // Only a completed handshake admits the retained tree; persisted descriptors start at generation zero.
  if (known && connection.generation > 0) return children
  const refused = connection.phase === 'identity-drift' || connection.phase === 'protocol-mismatch'
  if (refused || (query.isError && !query.data && !known)) {
    return (
      <div className='bg-background text-foreground grid min-h-svh place-content-center gap-4 p-8'>
        <InlineError
          message={
            refused ? refusalMessage(connection, origin) : toClientError(query.error).message
          }
          title='Server connection'
        />
        <Button onClick={() => retry.mutate()} disabled={retry.isPending || query.isFetching}>
          {retry.isPending || query.isFetching ? <Spinner /> : null} Retry connection
        </Button>
      </div>
    )
  }
  if (known) return children
  if (query.isPending) {
    return (
      <div
        role='status'
        className='bg-background text-foreground grid min-h-svh place-content-center gap-3'
      >
        <Spinner size='lg' className='mx-auto' />
        <p className='text-sm'>Connecting to server…</p>
      </div>
    )
  }
  return children
}
