import { confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { canonicalServerOrigin } from '@workspace/client-core/transport/client'
import { queryClientFor } from '@/lib/environments/state/query-clients'
import { environmentClientFor } from '@/lib/client'
import { createSessionDetailSubscriptionCache } from '@/features/chat/state/session-detail-subscriptions'
import { createSessionEarlierPageLoader } from '@/features/chat/state/session-earlier-pages'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { fetchOrchestrationSessionDetailSnapshotHttp } from '@/features/chat/transport/orchestration-http-snapshots'
import {
  createOrchestrationRpcClient,
  type WebOrchestrationRpcClientOptions,
} from '@/features/chat/transport/orchestration-rpc-client'
import { createOrchestrationRpcClosedError } from '@workspace/client-core/transport/structured-errors'

export function createChatTransport(
  origin: string,
  options: Omit<WebOrchestrationRpcClientOptions, 'origin'> = {},
): ChatTransport {
  origin = canonicalServerOrigin(origin)
  const environmentId = confirmedEnvironmentId(origin)
  const client = environmentClientFor(origin)
  const rpc = createOrchestrationRpcClient({ ...options, origin })
  const lifetime = new AbortController()
  const cache = createSessionDetailSubscriptionCache({ transport: rpc, environmentId })
  const pages = createSessionEarlierPageLoader({
    transport: rpc,
    environmentId,
    queryClient: queryClientFor(origin),
  })

  return {
    environmentId,
    get closed() {
      return rpc.closed
    },
    close() {
      if (rpc.closed) return
      cache.disposeAll()
      pages.dispose()
      lifetime.abort(createOrchestrationRpcClosedError())
      rpc.close()
    },
    dispatchCommand: rpc.dispatchCommand.bind(rpc),
    replayEvents: rpc.replayEvents.bind(rpc),
    shellStream: rpc.shellStream.bind(rpc),
    sessionDetailPage: rpc.sessionDetailPage.bind(rpc),
    sessionDetailStream: rpc.sessionDetailStream.bind(rpc),
    retainSessionDetail: cache.retain,
    loadEarlierPage: pages.load,
    earlierPageObserver: pages.observer,
    async sessionDetailSnapshot(sessionId) {
      lifetime.signal.throwIfAborted()
      confirmedEnvironmentId(origin)
      const snapshot = await fetchOrchestrationSessionDetailSnapshotHttp(
        sessionId,
        client,
        lifetime.signal,
      )
      confirmedEnvironmentId(origin)
      return snapshot
    },
  }
}
