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
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { StatusFrame } from '@workspace/ui/patterns/status-frame'

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
  const drifted = connection.phase === 'identity-drift'
  async function reconnect() {
    const primary = origin === primaryServerOrigin()
    if (drifted && primary) return connections.trustPrimary()
    if (drifted && machine) return connections.trustMachine(machine.name)
    if (primary) return connections.retryPrimary()
    if (machine) return connections.retryMachine(machine.name)
  }
  const retry = useMutation({
    mutationKey: environmentMutationKeys.machine('connect', machine?.name ?? '@primary'),
    scope: { id: `environment-retry:${origin}` },
    mutationFn: async () => {
      await reconnect()
      await query.refetch()
    },
  })
  // Only a completed handshake admits the retained tree; persisted descriptors start at generation zero.
  if (known && connection.generation > 0) return children
  const refused = drifted || connection.phase === 'protocol-mismatch'
  if (refused || (query.isError && !query.data && !known)) {
    return (
      <StatusFrame
        action={
          <Button onClick={() => retry.mutate()} disabled={retry.isPending || query.isFetching}>
            {retry.isPending || query.isFetching ? <Spinner /> : null}{' '}
            {drifted ? 'Trust replacement' : 'Retry connection'}
          </Button>
        }
        detail={
          refused
            ? refusalMessage(connection, origin)
            : clientErrorDescription(toClientError(query.error))
        }
        title='Cannot connect to the server'
        tone='error'
      />
    )
  }
  if (known) return children
  if (query.isPending) return <StatusFrame title='Connecting to server…' tone='pending' />
  return children
}
