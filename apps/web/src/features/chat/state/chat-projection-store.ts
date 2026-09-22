import {
  createInitialChatProjectionSlice,
  type ChatProjectionSlice,
} from '@workspace/client-core/chat/types'
import {
  type EnvironmentId,
  type OrchestrationEvent,
  type OrchestrationShellSnapshot,
  type OrchestrationShellStreamItem,
  type OrchestrationSessionDetailPage,
  type OrchestrationSessionDetailSnapshot,
  type OrchestrationSessionStreamItem,
} from '@workspace/contracts'
import { Throttler } from '@tanstack/react-pacer/throttler'
import { clientLogEnabled } from '@/lib/client-logging'
import { create } from 'zustand'

import {
  chatEventSummary,
  chatStreamItemSummary,
  chatSessionSnapshotSummary,
  createChatPipelineScope,
  type ChatPipelineScope,
} from '@/features/chat/utils/pipeline-logging'
import { discardTimelineReloadForSessions } from '@/features/chat/state/timeline-reload'
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
const projectionLogFlush = new Throttler(flushProjectionLogScope, {
  leading: false,
  wait: CHAT_PROJECTION_LOG_FLUSH_MS,
})

export function createInitialChatProjectionState(): ChatProjectionState {
  return { slices: {} }
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
    recordProjectionMutation('applyEvent', () => ({ environmentId, ...chatEventSummary(event) }))
    discardTimelineReloadForSessions(environmentId, [event])
    set((state) =>
      updateSlice(state, environmentId, (slice) => applyChatProjectionEvents(slice, [event])),
    )
  },
  applyOrchestrationEvents: (environmentId, events) => {
    recordProjectionMutation('applyEvents', () => ({ environmentId, eventCount: events.length }))
    discardTimelineReloadForSessions(environmentId, events)
    set((state) =>
      updateSlice(state, environmentId, (slice) => applyChatProjectionEvents(slice, events)),
    )
  },
  applyShellStreamItem: (environmentId, item) => {
    recordProjectionMutation('applyShellStreamItem', () => ({
      environmentId,
      ...chatStreamItemSummary(item),
    }))
    set((state) =>
      updateSlice(state, environmentId, (slice) => applyChatProjectionShellStreamItem(slice, item)),
    )
  },
  applySessionStreamItem: (environmentId, item) => {
    recordProjectionMutation('applySessionStreamItem', () => ({
      environmentId,
      ...chatStreamItemSummary(item),
    }))
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        applyChatProjectionSessionStreamItem(slice, item),
      ),
    )
  },
  prependSessionDetailPage: (environmentId, page) => {
    recordProjectionMutation('prependSessionDetailPage', () => ({
      environmentId,
      sessionId: page.sessionId,
    }))
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
    recordProjectionMutation('syncShellSnapshot', () => ({
      environmentId,
      snapshotSequence: snapshot.snapshotSequence,
    }))
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        syncChatProjectionShellSnapshot(slice, snapshot),
      ),
    )
  },
  syncSessionDetailSnapshot: (environmentId, snapshot) => {
    recordProjectionMutation('syncSessionDetailSnapshot', () => ({
      environmentId,
      ...chatSessionSnapshotSummary(snapshot),
    }))
    set((state) =>
      updateSlice(state, environmentId, (slice) =>
        syncChatProjectionSessionDetailSnapshot(slice, snapshot),
      ),
    )
  },
}))

function recordProjectionMutation(kind: string, context: () => Record<string, unknown>) {
  if (!clientLogEnabled('debug')) return
  const scope = currentProjectionLogScope()
  scope.increment('projection.mutationCount')
  scope.increment(`projection.${kind}Count`)
  scope.set({
    projection: {
      latest: {
        kind,
        ...context(),
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
