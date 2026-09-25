import { elapsedMs } from '@workspace/utils/timing'
import type { EnvironmentId, SessionId } from '@workspace/contracts'

import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { useChatProjectionStore } from '@/features/chat/state/chat-projection-store'

import {
  chatSessionSnapshotSummary,
  createChatPipelineScope,
  logChatPipelineInfo,
  logChatPipelineWarn,
} from '@/features/chat/utils/pipeline-logging'

export async function syncSessionProjectionAfterDispatch({
  transport,
  replayAfterSequence,
  sessionId,
}: {
  transport: ChatTransport
  replayAfterSequence: number
  sessionId: SessionId
}) {
  const startedAt = performance.now()
  const scope = createChatPipelineScope('chat.dispatch.sync.summary', {
    replayAfterSequence,
    sessionId,
  })
  scope.increment('sync.startCount')

  try {
    const replayEvents = Promise.resolve().then(() =>
      transport.replayEvents({
        afterSequence: Math.max(0, replayAfterSequence),
        sessionId,
      }),
    )
    const sessionDetailSnapshot = Promise.resolve().then(() =>
      transport.sessionDetailSnapshot(sessionId),
    )
    const [replay, snapshot] = await Promise.allSettled([replayEvents, sessionDetailSnapshot])
    if (transport.closed || (replay.status === 'rejected' && snapshot.status === 'rejected')) {
      scope.warn('Session projection synchronization failed.', {
        sessionId,
        transportClosed: transport.closed,
        replayStatus: replay.status,
        snapshotStatus: snapshot.status,
      })
      return
    }
    const store = useChatProjectionStore.getState()

    applyReplaySyncResult(scope, store, transport.environmentId, replay, replayAfterSequence)
    applySnapshotSyncResult(scope, store, transport.environmentId, snapshot)
  } finally {
    scope.end({ durationMs: elapsedMs(startedAt) })
  }
}

export function scheduleSessionProjectionSyncAfterDispatch({
  transport,
  replayAfterSequence,
  sessionId,
}: {
  transport: ChatTransport
  replayAfterSequence: number
  sessionId: SessionId
}) {
  logChatPipelineInfo('chat.dispatch.sync.scheduled', {
    replayAfterSequence,
    sessionId,
  })

  void syncSessionProjectionAfterDispatch({ transport, replayAfterSequence, sessionId }).catch(
    (error: unknown) => {
      logChatPipelineWarn('chat.dispatch.sync.unhandled_failure', {
        error,
        sessionId,
      })
    },
  )
}

function applyReplaySyncResult(
  scope: ReturnType<typeof createChatPipelineScope>,
  store: ReturnType<typeof useChatProjectionStore.getState>,
  environmentId: EnvironmentId,
  replay: PromiseSettledResult<Awaited<ReturnType<ChatTransport['replayEvents']>>>,
  replayAfterSequence: number,
) {
  if (replay.status !== 'fulfilled') {
    scope.increment('sync.replayFailedCount')
    scope.warn('Replay sync failed.', { error: replay.reason })
    scope.set({ replayStatus: replay.status })
    return
  }

  store.applyOrchestrationEvents(environmentId, replay.value.events)
  scope.increment('sync.replayAppliedCount')
  scope.increment('sync.replayEventCount', replay.value.events.length)
  scope.set({
    replay: {
      eventTypes: replay.value.events.map((event) => event.type),
      maxSequence: replay.value.events.at(-1)?.sequence ?? replayAfterSequence,
    },
    replayStatus: replay.status,
  })
}

function applySnapshotSyncResult(
  scope: ReturnType<typeof createChatPipelineScope>,
  store: ReturnType<typeof useChatProjectionStore.getState>,
  environmentId: EnvironmentId,
  snapshot: PromiseSettledResult<Awaited<ReturnType<ChatTransport['sessionDetailSnapshot']>>>,
) {
  if (snapshot.status !== 'fulfilled') {
    scope.increment('sync.snapshotFailedCount')
    scope.warn('Snapshot sync failed.', { error: snapshot.reason })
    scope.set({ snapshotStatus: snapshot.status })
    return
  }

  store.syncSessionDetailSnapshot(environmentId, snapshot.value)
  scope.increment('sync.snapshotAppliedCount')
  scope.set({
    snapshot: chatSessionSnapshotSummary(snapshot.value),
    snapshotStatus: snapshot.status,
  })
}
