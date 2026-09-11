import { clientLogContext } from '@/lib/environments/state/log-context'
import type {
  OrchestrationShellSnapshot,
  OrchestrationSessionDetailSnapshot,
  SessionId,
} from '@workspace/contracts'

import type { Client } from '@/lib/client'
import { observeClientOperation } from '@/lib/client-logging'
import { unwrapEdenResponse } from '@/lib/eden-events'

/**
 * `fetch` has no deadline of its own, and the socket requests these replaced
 * gave up at 60s. There is no cheaper fallback read to fail over to, so the
 * bound matches that one rather than tightening it.
 */
const ORCHESTRATION_SNAPSHOT_TIMEOUT_MS = 60_000

/**
 * The two authoritative snapshot reads go over HTTP, never over the
 * orchestration socket. A shell snapshot for a workspace with hundreds of
 * sessions is one large frame, and the socket writes frames in order: while it
 * is on the wire, every ping, dispatch and subscription frame waits behind it.
 * Commands, replay and the subscriptions — including the `kind: 'snapshot'`
 * frames they deliver — stay on the socket, where ordering against the event
 * stream is the whole point.
 */
export function fetchOrchestrationShellSnapshotHttp(client: Client, signal?: AbortSignal) {
  return observeClientOperation(
    { ...clientLogContext(client), action: 'chat.shell_snapshot.http', area: 'chat' },
    async () => {
      const response = await client.orchestration['shell-snapshot'].get({
        fetch: {
          signal: signal
            ? AbortSignal.any([signal, snapshotTimeoutSignal()])
            : snapshotTimeoutSignal(),
        },
      })
      signal?.throwIfAborted()
      return unwrapEdenResponse<OrchestrationShellSnapshot>(response, {
        emptyMessage: 'the shell snapshot response carried no data',
        // Eden revives every date-shaped string on the way out. The projection
        // writers are typed against the contracts, where these are ISO strings.
        normalizeDates: true,
        requireData: true,
      })
    },
    (snapshot) => ({
      projectCount: snapshot.projects.length,
      snapshotSequence: snapshot.snapshotSequence,
      sessionCount: snapshot.sessions.length,
    }),
  )
}

export function fetchOrchestrationSessionDetailSnapshotHttp(
  sessionId: SessionId,
  client: Client,
  signal?: AbortSignal,
) {
  return observeClientOperation(
    {
      ...clientLogContext(client),
      action: 'chat.session_detail_snapshot.http',
      area: 'chat',
      sessionId,
    },
    async () => {
      const response = await client.orchestration['session-detail'].get({
        fetch: {
          signal: signal
            ? AbortSignal.any([signal, snapshotTimeoutSignal()])
            : snapshotTimeoutSignal(),
        },
        query: { sessionId },
      })

      signal?.throwIfAborted()
      return unwrapEdenResponse<OrchestrationSessionDetailSnapshot>(response, {
        emptyMessage: 'the session detail snapshot response carried no data',
        normalizeDates: true,
        requireData: true,
      })
    },
    (snapshot) => ({
      activityCount: snapshot.session.activities.length,
      latestTurnState: snapshot.session.latestTurn?.state ?? null,
      messageCount: snapshot.session.messages.length,
      sessionStatus: snapshot.session.runtime?.status ?? null,
      snapshotSequence: snapshot.snapshotSequence,
    }),
  )
}

function snapshotTimeoutSignal() {
  return AbortSignal.timeout(ORCHESTRATION_SNAPSHOT_TIMEOUT_MS)
}
