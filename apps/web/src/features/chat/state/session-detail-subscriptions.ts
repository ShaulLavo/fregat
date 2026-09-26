import {
  errorStringField,
  type OrchestrationSessionStreamItem,
  type SessionRuntimeState,
  type SessionId,
  type EnvironmentId,
} from '@workspace/contracts'

import { errorMessage } from '@/lib/error-message'
import type { ChatTransport } from '@/features/chat/transport/chat-transport'
import { createOrchestrationRpcClosedError } from '@workspace/client-core/transport/structured-errors'
import { isOrchestrationConnectionFailure } from '@workspace/client-core/transport/orchestration-rpc-client'
import {
  chatStreamItemSummary,
  createChatPipelineScope,
  type ChatPipelineScope,
} from '@/features/chat/utils/pipeline-logging'
import { isBlockedStreamError, streamReconnectDelayMs } from '../utils/stream-reconnect'
import {
  MAX_CACHED_SESSION_DETAIL_SUBSCRIPTIONS,
  SESSION_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS,
} from '@workspace/client-core/chat/cache-constants'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
  type ChatProjectionStore,
} from './chat-projection-store'
import {
  useSessionDetailSyncStore,
  type SessionDetailSyncState,
  type SessionDetailSyncStatus,
} from './session-detail-sync-store'

type TimeoutHandle = number | ReturnType<typeof setTimeout>

type ChatProjectionStoreAccess = {
  getState: () => ChatProjectionStore
  subscribe?: (listener: (state: ChatProjectionStore) => void) => () => void
}

type DisposeReason = 'capacity' | 'deleted' | 'idle' | 'shutdown'

export type SessionDetailSubscriptionSnapshot = {
  active: boolean
  attempt: number
  error: string | null
  hasEvictionTimer: boolean
  lastAccessedAt: number
  refCount: number
  status: SessionDetailSyncStatus
  sessionId: SessionId
}

export type SessionDetailSubscriptionCacheOptions = {
  environmentId: EnvironmentId
  clearScheduledTimeout?: (handle: TimeoutHandle) => void
  transport: Pick<ChatTransport, 'sessionDetailStream'>
  idleEvictionMs?: number
  maxCachedSubscriptions?: number
  now?: () => number
  scheduleTimeout?: (callback: () => void, delay: number) => TimeoutHandle
  store?: ChatProjectionStoreAccess
}

type SessionDetailStreamOutcome = {
  blocked: boolean
  error: string | null
}

type SessionDetailSubscriptionEntry = {
  abortController: AbortController | null
  active: boolean
  evictionTimeoutId: TimeoutHandle | null
  failureCount: number
  /** When the entry's first stream started; cleared once its snapshot lands (`firstSnapshotMs`). */
  firstStartedAt: number | null
  lastAccessedAt: number
  /** True once the session has been seen in the projection, so a later absence means deletion. */
  observedInProjection: boolean
  refCount: number
  scope: ChatPipelineScope
  sync: SessionDetailSyncState
  sessionId: SessionId
}

const IDLE_SYNC: SessionDetailSyncState = { attempt: 0, error: null, status: 'idle' }
const SESSION_DETAIL_STREAM_FAILED = 'Session sync failed.'

export function createSessionDetailSubscriptionCache(
  options: SessionDetailSubscriptionCacheOptions,
) {
  const entries = new Map<SessionId, SessionDetailSubscriptionEntry>()
  const store = options.store ?? useChatProjectionStore
  const idleEvictionMs = options.idleEvictionMs ?? SESSION_DETAIL_SUBSCRIPTION_IDLE_EVICTION_MS
  const maxCachedSubscriptions =
    options.maxCachedSubscriptions ?? MAX_CACHED_SESSION_DETAIL_SUBSCRIPTIONS
  const now = options.now ?? Date.now
  const scheduleTimeout = options.scheduleTimeout ?? setTimeout
  const clearScheduledTimeout = options.clearScheduledTimeout ?? clearTimeout
  let disposed = false
  let unsubscribeProjection: (() => void) | null = null

  function retain(sessionId: SessionId) {
    if (disposed) throw createOrchestrationRpcClosedError()
    unsubscribeProjection ??= store.subscribe?.(handleProjectionChange) ?? null
    const entry = getOrCreateEntry(sessionId)
    entry.scope.increment('subscription.retainCount')
    entry.scope.set({
      refCount: entry.refCount + 1,
    })
    clearEntryEviction(entry)
    entry.refCount += 1
    entry.lastAccessedAt = now()
    startSessionDetailSubscription(entry)
    evictIdleEntriesToCapacity()

    let released = false

    return () => {
      if (released || disposed) return

      released = true
      entry.refCount = Math.max(0, entry.refCount - 1)
      entry.lastAccessedAt = now()
      entry.scope.increment('subscription.releaseCount')
      entry.scope.set({
        refCount: entry.refCount,
      })
      reconcileEntryEviction(entry)
      evictIdleEntriesToCapacity()
    }
  }

  function reconcileAll() {
    for (const entry of entries.values()) {
      reconcileEntryEviction(entry)
    }

    evictIdleEntriesToCapacity()
  }

  function disposeAll() {
    if (disposed) return
    disposed = true
    const sessionIds = Array.from(entries.keys())

    for (const sessionId of sessionIds) {
      disposeEntry(sessionId, 'shutdown')
    }

    unsubscribeProjection?.()
  }

  function snapshot(): SessionDetailSubscriptionSnapshot[] {
    return [...entries.values()].map((entry) => ({
      active: entry.active,
      attempt: entry.sync.attempt,
      error: entry.sync.error,
      hasEvictionTimer: entry.evictionTimeoutId !== null,
      lastAccessedAt: entry.lastAccessedAt,
      refCount: entry.refCount,
      status: entry.sync.status,
      sessionId: entry.sessionId,
    }))
  }

  /**
   * The projection is the client's source of truth for which sessions exist, so a
   * session that leaves it has been deleted: its stream and wide-event scope die
   * with it. Every other change can flip an entry's eviction protection, so the
   * eviction timers are reconciled on the same tick.
   */
  function handleProjectionChange(state: ChatProjectionStore) {
    // Copied: disposing a deleted session mutates `entries` mid-iteration.
    for (const entry of Array.from(entries.values())) {
      if (
        selectChatProjectionSlice(state, options.environmentId).sessionById[entry.sessionId]
          ?.metaSource === 'shell'
      ) {
        entry.observedInProjection = true
        continue
      }
      if (!entry.observedInProjection) continue

      disposeEntry(entry.sessionId, 'deleted')
    }

    reconcileAll()
  }

  function getOrCreateEntry(sessionId: SessionId) {
    const existing = entries.get(sessionId)
    if (existing) return existing

    const entry: SessionDetailSubscriptionEntry = {
      abortController: null,
      active: false,
      evictionTimeoutId: null,
      failureCount: 0,
      firstStartedAt: now(),
      lastAccessedAt: now(),
      observedInProjection:
        selectChatProjectionSlice(store.getState(), options.environmentId).sessionById[sessionId]
          ?.metaSource === 'shell',
      refCount: 0,
      scope: createChatPipelineScope('chat.session_detail_subscription.summary', { sessionId }),
      sync: IDLE_SYNC,
      sessionId,
    }

    entries.set(sessionId, entry)

    return entry
  }

  function startSessionDetailSubscription(entry: SessionDetailSubscriptionEntry) {
    if (entry.abortController !== null) return

    const abortController = new AbortController()
    entry.abortController = abortController
    entry.active = true
    entry.failureCount = 0
    entry.scope.increment('subscription.startCount')
    entry.scope.set({
      refCount: entry.refCount,
    })

    void superviseSessionDetailStream(entry, abortController)
  }

  /**
   * A single `for await` dies for good on the first transport error, which froze
   * open conversations mid-turn after every server restart. Each attempt is
   * re-armed here instead, resuming from the sequence the projection already
   * applied so a reconnect replays the gap rather than the whole session.
   */
  async function superviseSessionDetailStream(
    entry: SessionDetailSubscriptionEntry,
    abortController: AbortController,
  ) {
    const signal = abortController.signal

    while (!signal.aborted) {
      const outcome = await runSessionDetailStreamOnce(entry, signal)
      if (signal.aborted) break
      if (outcome.blocked) {
        publishSync(entry, { attempt: entry.failureCount, error: outcome.error, status: 'blocked' })
        break
      }

      entry.failureCount += 1
      const delayMs = streamReconnectDelayMs(entry.failureCount)
      entry.scope.increment('stream.reconnectCount')
      entry.scope.set({
        reconnect: { delayMs, failureCount: entry.failureCount },
      })
      publishSync(entry, {
        attempt: entry.failureCount,
        error: outcome.error,
        status: 'reconnecting',
      })
      await waitBeforeReconnect(delayMs, signal)
    }

    finishSessionDetailSubscription(entry, abortController)
  }

  async function runSessionDetailStreamOnce(
    entry: SessionDetailSubscriptionEntry,
    signal: AbortSignal,
  ): Promise<SessionDetailStreamOutcome> {
    const afterSequence =
      selectChatProjectionSlice(store.getState(), options.environmentId).sessionDetailSequenceById[
        entry.sessionId
      ] ?? 0
    entry.scope.increment('stream.openCount')
    entry.scope.set({
      afterSequence,
    })
    publishSync(entry, {
      attempt: entry.failureCount,
      error: entry.sync.error,
      status: connectingStatus(entry),
    })
    const onSynchronized = () => {
      if (signal.aborted) return
      markSessionDetailStreamLive(entry)
    }

    try {
      for await (const item of options.transport.sessionDetailStream(entry.sessionId, {
        afterSequence,
        onSynchronized,
        signal,
      })) {
        if (signal.aborted) return { blocked: false, error: null }
        markSessionDetailStreamLive(entry)
        applySessionStreamItem(entry, item)
      }

      return { blocked: false, error: null }
    } catch (error) {
      if (signal.aborted) return { blocked: false, error: null }

      entry.scope.increment('stream.errorCount')
      recordStreamFailure(entry.scope, error, afterSequence)

      return {
        blocked: isBlockedStreamError(error),
        error: errorMessage(error, SESSION_DETAIL_STREAM_FAILED),
      }
    } finally {
      entry.scope.increment('stream.closeCount')
    }
  }

  function finishSessionDetailSubscription(
    entry: SessionDetailSubscriptionEntry,
    abortController: AbortController,
  ) {
    if (entry.abortController !== abortController) return

    entry.abortController = null
    entry.active = false
    entry.scope.set({
      aborted: abortController.signal.aborted,
    })
  }

  function markSessionDetailStreamLive(entry: SessionDetailSubscriptionEntry) {
    entry.failureCount = 0
    if (entry.sync.status === 'live') return

    publishSync(entry, { attempt: 0, error: null, status: 'live' })
  }

  function waitBeforeReconnect(delayMs: number, signal: AbortSignal) {
    return new Promise<void>((resolve) => {
      const settle = () => {
        signal.removeEventListener('abort', onAbort)
        clearScheduledTimeout(timeoutId)
        resolve()
      }
      const onAbort = () => settle()
      const timeoutId = scheduleTimeout(settle, delayMs)

      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  function applySessionStreamItem(
    entry: SessionDetailSubscriptionEntry,
    item: OrchestrationSessionStreamItem,
  ) {
    // Stream traffic is access: without it the LRU ordered by retain time alone
    // would evict the busiest session first.
    entry.lastAccessedAt = now()
    entry.scope.increment('stream.itemCount')
    entry.scope.set({
      stream: {
        latestItem: chatStreamItemSummary(item),
      },
    })
    if (item.kind === 'snapshot') {
      store.getState().syncSessionDetailSnapshot(options.environmentId, item.snapshot)
      if (entry.firstStartedAt === null) return
      entry.scope.set({ firstSnapshotMs: now() - entry.firstStartedAt })
      entry.firstStartedAt = null
      return
    }

    store.getState().applyOrchestrationEvent(options.environmentId, item.event)
  }

  function publishSync(entry: SessionDetailSubscriptionEntry, sync: SessionDetailSyncState) {
    entry.sync = sync
    useSessionDetailSyncStore
      .getState()
      .setSessionDetailSync(
        { environmentId: options.environmentId, sessionId: entry.sessionId },
        sync,
      )
  }

  function clearEntryEviction(entry: SessionDetailSubscriptionEntry) {
    if (entry.evictionTimeoutId === null) return

    clearScheduledTimeout(entry.evictionTimeoutId)
    entry.evictionTimeoutId = null
  }

  function reconcileEntryEviction(entry: SessionDetailSubscriptionEntry) {
    if (!shouldEvictEntry(entry)) {
      clearEntryEviction(entry)
      return
    }
    // Never restart a running countdown: reconciliation runs on every projection
    // mutation, and re-arming there would push idle eviction out forever.
    if (entry.evictionTimeoutId !== null) return

    entry.evictionTimeoutId = scheduleTimeout(() => {
      entry.evictionTimeoutId = null
      if (!shouldEvictEntry(entry)) return

      disposeEntry(entry.sessionId, 'idle')
    }, idleEvictionMs)
  }

  function evictIdleEntriesToCapacity() {
    if (entries.size <= maxCachedSubscriptions) return

    const idleEntries = [...entries.values()]
      .filter(shouldEvictEntry)
      .toSorted((left, right) => left.lastAccessedAt - right.lastAccessedAt)

    for (const entry of idleEntries) {
      if (entries.size <= maxCachedSubscriptions) return

      disposeEntry(entry.sessionId, 'capacity')
    }
  }

  function shouldEvictEntry(entry: SessionDetailSubscriptionEntry) {
    if (entry.refCount > 0) return false

    return !isProtectedSession(entry.sessionId)
  }

  function isProtectedSession(sessionId: SessionId) {
    const session = selectChatProjectionSlice(store.getState(), options.environmentId).sessionById[
      sessionId
    ]
    if (!session) return false
    if (session.hasActionableProposedPlan) return true
    if (session.pendingApprovalCount > 0) return true
    if (session.pendingUserInputCount > 0) return true
    if (session.latestTurn?.state === 'running') return true
    if (session.liveTurn?.state === 'running') return true
    if (session.pendingSourceProposedPlan !== undefined) return true

    return isBusySession(session.runtime)
  }

  function disposeEntry(sessionId: SessionId, reason: DisposeReason) {
    const entry = entries.get(sessionId)
    if (!entry) return false

    clearEntryEviction(entry)
    entries.delete(sessionId)
    const wasActive = entry.abortController !== null
    entry.abortController?.abort()
    entry.abortController = null
    entry.active = false
    entry.sync = IDLE_SYNC
    useSessionDetailSyncStore
      .getState()
      .clearSessionDetailSync({ environmentId: options.environmentId, sessionId })
    entry.scope.increment('subscription.disposeCount')
    entry.scope.end({ aborted: wasActive, disposeReason: reason, refCount: entry.refCount })

    return true
  }

  return {
    disposeAll,
    retain,
    snapshot,
    size: () => entries.size,
  }
}

function connectingStatus(entry: SessionDetailSubscriptionEntry): SessionDetailSyncStatus {
  if (entry.failureCount === 0) return 'connecting'

  return 'reconnecting'
}

function isBusySession(runtime: SessionRuntimeState | null) {
  if (!runtime) return false

  return (
    runtime.status === 'starting' || runtime.status === 'running' || runtime.status === 'waiting'
  )
}

// A dead socket warns once in the connection's failure series; this entry only counts it.
function recordStreamFailure(scope: ChatPipelineScope, error: unknown, afterSequence: number) {
  if (isOrchestrationConnectionFailure(error)) {
    scope.set({ stream: { lastFailureCode: errorStringField(error, 'code') } })
    return
  }
  scope.warn('Session detail stream failed.', { afterSequence, error })
}
