import { environmentQueryKeys } from '@/features/environments/utils/query-keys'
import { useQuery } from '@tanstack/react-query'
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
      <StatusFrame
        action={
          <Button onClick={() => void query.refetch()} disabled={query.isFetching}>
            {query.isFetching ? <Spinner /> : null} Retry connection
          </Button>
        }
        detail={
          refused
            ? 'This server’s identity or protocol has changed. Reconnect the original server.'
            : clientErrorDescription(toClientError(query.error))
        }
        title='Cannot connect to the server'
        tone='error'
      />
    )
  }
  if (query.isPending) return <StatusFrame title='Connecting to server…' tone='pending' />
  return children
}
