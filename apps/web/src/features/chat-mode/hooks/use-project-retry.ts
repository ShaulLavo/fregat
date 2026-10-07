import { useMutation } from '@tanstack/react-query'
import { createWorkspaceProjectCommand } from '@workspace/client-core/chat/commands'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { transportFor } from '@/features/chat/state/active-transports'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'
import { fetchOrchestrationShellSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { useEnvironmentConnections } from '@/hooks/use-environment-connections'
import { environmentClientFor, primaryServerOrigin } from '@/lib/client'
import { log } from '@/lib/client-logging'
import { errorMessage } from '@/lib/error-message'
import type { EnvironmentConnections } from '@/state/environment-connections'

type ProjectRetry = { readonly transport: ChatTransport; readonly rootPath: string }

export function useProjectRetry({ transport, rootPath }: ProjectRetry) {
  const connections = useEnvironmentConnections()
  const attempt = useMutation({
    mutationKey: chatModeMutationKeys.projectRetry(transport.environmentId, rootPath),
    scope: { id: `chat-project-retry:${transport.environmentId}:${rootPath}` },
    retry: false,
    mutationFn: (request: ProjectRetry) => requestWorkspaceProject(request, connections),
  })
  const current =
    attempt.variables?.transport === transport &&
    attempt.variables.rootPath === rootPath &&
    !transport.closed
  return {
    error:
      current && attempt.error
        ? errorMessage(attempt.error, 'Could not prepare chat for this workspace.')
        : null,
    retrying:
      attempt.isPending &&
      attempt.variables?.rootPath === rootPath &&
      attempt.variables.transport === transport,
    retryProject() {
      if (
        attempt.isPending &&
        attempt.variables?.transport === transport &&
        attempt.variables.rootPath === rootPath
      )
        return
      attempt.mutate({ transport, rootPath })
    },
  }
}

async function requestWorkspaceProject(
  { transport, rootPath }: ProjectRetry,
  connections: EnvironmentConnections,
) {
  const origin = connections.originFor(transport.environmentId)
  if (transport.closed) {
    if (origin === primaryServerOrigin()) await connections.retryPrimary()
    else {
      const machine = connections.store
        .getState()
        .machines.find((entry) => entry.environmentId === transport.environmentId)
      if (machine) await connections.retryMachine(machine.name)
    }
    // An in-flight health check owns replacement and will trigger initial folder setup.
    return
  }
  try {
    const result = await transport.dispatchCommand(createWorkspaceProjectCommand({ rootPath }))
    if (!origin || transport.closed || transportFor(transport.environmentId) !== transport) return
    const snapshot = await fetchOrchestrationShellSnapshotHttp(environmentClientFor(origin))
    if (transport.closed || transportFor(transport.environmentId) !== transport) return
    useChatProjectionStore.getState().syncShellSnapshot(transport.environmentId, snapshot)
    log.info({
      action: 'chat.project.retry',
      area: 'chat',
      commandType: 'project.create',
      deduped: result.deduped,
      outcome: 'ok',
      rootPath,
      sequence: result.sequence,
    })
  } catch (error) {
    if (transport.closed || transportFor(transport.environmentId) !== transport) return
    log.warn({
      action: 'chat.project.retry',
      area: 'chat',
      commandType: 'project.create',
      outcome: 'error',
      reason: errorMessage(error, 'Could not prepare chat for this workspace.'),
      rootPath,
    })
    throw error
  }
}
