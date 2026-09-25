import type { ScopedSessionRef } from '@workspace/contracts'
import { useMutationState } from '@tanstack/react-query'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { McpServerRow } from '@/features/chat/components/mcp-server-row'
import { useReconnectMcpServer } from '@/features/chat/hooks/use-reconnect-mcp-server'
import type { useSessionMcp } from '@/features/chat/hooks/use-session-mcp'
import { useSignInMcpServer } from '@/features/chat/hooks/use-sign-in-mcp-server'
import { chatMutationKeys } from '@/features/chat/utils/mutation-keys'
import { errorMessage } from '@/lib/error-message'

export function SessionMcpList({
  mcp,
  sessionRef,
}: {
  readonly mcp: ReturnType<typeof useSessionMcp>
  readonly sessionRef: ScopedSessionRef
}) {
  const reconnect = useReconnectMcpServer(sessionRef)
  const signIn = useSignInMcpServer(sessionRef)
  const reconnecting = useMutationState({
    filters: {
      mutationKey: chatMutationKeys.reconnectMcpServer(
        sessionRef.environmentId,
        sessionRef.sessionId,
      ),
      status: 'pending',
    },
    select: (mutation) => mutation.state.variables,
  })
  const signingIn = useMutationState({
    filters: {
      mutationKey: chatMutationKeys.signInMcpServer(sessionRef.environmentId, sessionRef.sessionId),
      status: 'pending',
    },
    select: (mutation) => mutation.state.variables,
  })
  const busy = [...reconnecting, ...signingIn]

  if (mcp.isPending)
    return (
      <LoadingState label='Loading MCP servers' className='p-(--density-row-padding-x)'>
        <div aria-hidden='true' className='skeleton-sweep h-3 w-40 rounded-md' />
      </LoadingState>
    )
  if (mcp.isError)
    return (
      <EmptyState
        align='start'
        title={errorMessage(mcp.error, 'MCP servers could not be read.')}
        tone='error'
      />
    )
  if (!mcp.data.running) return <EmptyState align='start' title='The session is not running.' />
  if (mcp.data.servers.length === 0) return <EmptyState align='start' title='No MCP servers' />

  return mcp.data.servers.map((server) => (
    <McpServerRow
      busy={busy.includes(server.name)}
      canReconnect={mcp.data.canReconnect}
      canSignIn={mcp.data.canSignIn}
      key={server.name}
      onReconnect={() => reconnect.mutate(server.name)}
      onSignIn={() => signIn.mutate(server.name)}
      server={server}
    />
  ))
}
