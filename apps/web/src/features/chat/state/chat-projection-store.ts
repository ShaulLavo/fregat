import {
  createInitialChatProjectionSlice,
  type ChatProjectionSlice,
} from '@workspace/client-core/chat/types'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import {
  type EnvironmentId,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type OrchestrationSessionDetailPage,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionStreamItem,
} from '@workspace/contracts'
import { Debouncer } from '@tanstack/react-pacer/debouncer'
import { create } from 'zustand'

import {
  chatEventSummary,
  chatStreamItemSummary,
  chatSessionSnapshotSummary,
  createChatPipelineScope,
  type ChatPipelineScope,
} from '@/features/chat/utils/pipeline-logging'
import { CHAT_PROJECTION_CACHE_PERSIST_MS } from '@workspace/client-core/chat/cache-constants'
import {
  chatProjectionCacheFromState,
  hydrateChatProjectionState,
  readChatProjectionCache,
  writeChatProjectionCache,
} from './chat-projection-cache'
import {
  applyChatProjectionEvents,
  applyChatProjectionShellStreamItem,
  applyChatProjectionSessionStreamItem,
  prependChatProjectionSessionDetailPage,
  syncChatProjectionShellSnapshot,
  syncChatProjectionSessionDetailSnapshot,
} from '@workspace/client-core/chat/writers'

export type ChatProjectionState = {
  slices: Record<EnvironmentId, ChatProjectionSlice>
}

type ChatProjectionActions = {
  applyOrchestrationEvent(environmentId: EnvironmentId, event: OrchestrationEvent): void
  applyOrchestrationEvents(
    environmentId: EnvironmentId,
    events: readonly OrchestrationEvent[],
  ): void
  applyShellStreamItem(environmentId: EnvironmentId, item: OrchestrationShellStreamItem): void
  applySessionStreamItem(environmentId: EnvironmentId, item: OrchestrationSessionStreamItem): void
  prependSessionDetailPage(environmentId: EnvironmentId, page: OrchestrationSessionDetailPage): void
  dropEnvironment(environmentId: EnvironmentId): void
  resetChatProjection(): void
  syncShellSnapshot(environmentId: EnvironmentId, snapshot: OrchestrationShellSnapshot): void
  syncSessionDetailSnapshot(
    environmentId: EnvironmentId,
    snapshot: OrchestrationSessionDetailSnapshot,
  ): void
}

export type ChatProjectionStore = ChatProjectionState & ChatProjectionActions

const CHAT_PROJECTION_LOG_FLUSH_MS = 250

let projectionLogScope: ChatPipelineScope | null = null
const projectionLogFlush = new Debouncer(flushProjectionLogScope, {
  wait: CHAT_PROJECTION_LOG_FLUSH_MS,
})

export function createInitialChatProjectionState(): ChatProjectionState {
  return { slices: {} }
}

const projectionStorage = new Map<EnvironmentId, ScopedStorage>()

export function restoredChatProjectionState(storage: ScopedStorage): ChatProjectionState {
  return hydrateChatProjectionState(
    createInitialChatProjectionState(),
    readChatProjectionCache(storage),
  )
}

export function hydrateEnvironmentChatCache(storage: ScopedStorage) {
  projectionStorage.set(storage.environmentId, storage)
  const state = useChatProjectionStore.getState()
  if (state.slices[storage.environmentId]) return
  useChatProjectionStore.setState(
    hydrateChatProjectionState(state, readChatProjectionCache(storage)),
  )
}

const EMPTY_SLICE = createInitialChatProjectionSlice()

export function selectChatProjectionSlice(
  state: ChatProjectionState,
  environmentId: EnvironmentId,
): ChatProjectionSlice {
  return state.slices[environmentId] ?? EMPTY_SLICE
}

function updateSlice(
  state: ChatProjectionState,
  environmentId: EnvironmentId,
  update: (slice: ChatProjectionSlice) => ChatProjectionSlice,
): ChatProjectionState {
  const previous = state.slices[environmentId] ?? createInitialChatProjectionSlice()
  const next = update(previous)
  if (next === previous && state.slices[environmentId]) return state
  return { slices: { ...state.slices, [environmentId]: next } }
}

export const useChatProjectionStore = create<ChatProjectionStore>((set) => ({
  ...createInitialChatProjectionState(),
  applyOrchestrationEvent: (environmentId, event) => {
    recordProjectionMutation('applyEvent', { environmentId, ...chatEventSummary(event) })
    set((state) =>
      updateSlice(state, environmentId, (slice) => applyChatProjectionEvents(slice, [event])),
    )
  },
  applyOrchestrationEvents: (environmentId, events) => {
    recordProjectionMutation('applyEvents', { environmentId, eventCount: events.length })
    set((state) =>
      updateSlice(state, environmentId, (slice) => applyChatProjectionEvents(slice, events)),
    )
  },
  applyShellStreamItem: (environmentId, item) => {
    recordProjectionMutation('applyShellStreamItem', {
      environmentId,
      ...chatStreamItemSummary(item),
    })
    set((state) =>
      updateSlice(state, environmentId, (slice) => applyChatProjectionShellStreamItem(slice, item)),
    )
  },
  applySessionStreamItem: (environmentId, item) => {
    recordProjectionMutation('applySessionStreamItem', {
      environmentId,
      ...chatStreamItemSummary(item),
    })
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        applyChatProjectionSessionStreamItem(slice, item),
      ),
    )
  },
  prependSessionDetailPage: (environmentId, page) => {
    recordProjectionMutation('prependSessionDetailPage', {
      environmentId,
      sessionId: page.sessionId,
    })
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        prependChatProjectionSessionDetailPage(slice, page),
      ),
    )
  },
  dropEnvironment: (environmentId) =>
    set((state) => {
      const { [environmentId]: _removed, ...slices } = state.slices
      return { slices }
    }),
  resetChatProjection: () => set(createInitialChatProjectionState()),
  syncShellSnapshot: (environmentId, snapshot) => {
    recordProjectionMutation('syncShellSnapshot', {
      environmentId,
      snapshotSequence: snapshot.snapshotSequence,
    })
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        syncChatProjectionShellSnapshot(slice, snapshot),
      ),
    )
  },
  syncSessionDetailSnapshot: (environmentId, snapshot) => {
    recordProjectionMutation('syncSessionDetailSnapshot', {
      environmentId,
      ...chatSessionSnapshotSummary(snapshot),
    })
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        syncChatProjectionSessionDetailSnapshot(slice, snapshot),
      ),
    )
  },
}))

function recordProjectionMutation(kind: string, context: Record<string, unknown> = {}) {
  const scope = currentProjectionLogScope()
  scope.increment('projection.mutationCount')
  scope.increment(`projection.${kind}Count`)
  scope.set({
    projection: {
      latest: {
        kind,
        ...context,
      },
    },
  })
  projectionLogFlush.maybeExecute()
}

function currentProjectionLogScope() {
  if (projectionLogScope) return projectionLogScope

  projectionLogScope = createChatPipelineScope('chat.projection.summary')
  return projectionLogScope
}

function flushProjectionLogScope() {
  const scope = projectionLogScope
  projectionLogScope = null
  scope?.end()
}

/**
 * Throttled rather than debounced: a streaming turn mutates the projection
 * faster than any debounce window closes, so a debounce would never write until
 * the turn ended. Leading edge is off so the write costs one serialization per
 * window instead of one per burst start.
 */
let projectionPersistTimer: ReturnType<typeof setTimeout> | null = null

export function flushChatProjectionCache() {
  const cached = chatProjectionCacheFromState(useChatProjectionStore.getState())
  let written = true
  for (const storage of projectionStorage.values()) {
    if (!cached.slices.some((slice) => slice.environmentId === storage.environmentId)) continue
    if (!writeChatProjectionCache(storage, cached)) written = false
  }
  return written
}

useChatProjectionStore.subscribe(() => {
  scheduleChatProjectionCachePersist()
})

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('beforeunload', () => {
    flushChatProjectionCache()
  })
}

function scheduleChatProjectionCachePersist() {
  if (projectionPersistTimer) return

  projectionPersistTimer = setTimeout(persistChatProjectionCache, CHAT_PROJECTION_CACHE_PERSIST_MS)
}

function persistChatProjectionCache() {
  projectionPersistTimer = null
  flushChatProjectionCache()
}
