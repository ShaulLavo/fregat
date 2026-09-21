import { readTimelineReload } from '@/features/chat/state/timeline-reload'
import {
  storedEnvironmentScopes,
  type ScopedStorage,
} from '@/lib/environments/state/scoped-storage'
import {
  environmentIdSchema,
  healthDescriptorSchema,
  machineNameSchema,
  originMachineSchema,
  type EnvironmentId,
  orchestrationMessageSchema,
  orchestrationCheckpointSummarySchema,
  orchestrationProposedPlanSchema,
  orchestrationProjectShellSchema,
  orchestrationSessionActivitySchema,
  orchestrationSessionShellSchema,
  orchestrationWorktreeShellSchema,
  sessionIdSchema,
  type OrchestrationSessionShell,
  type SessionId,
} from '@workspace/contracts'
import * as v from 'valibot'
import {
  readWorkspaceCacheEntry,
  removeWorkspaceCacheEntry,
  writeWorkspaceCacheEntry,
} from '@/lib/workspace-cache-storage'

import {
  CHAT_PROJECTION_CACHE_ACTIVITY_LIMIT,
  CHAT_PROJECTION_CACHE_MESSAGE_LIMIT,
  CHAT_PROJECTION_CACHE_SESSION_LIMIT,
  CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT,
} from '@workspace/client-core/chat/cache-constants'
import {
  createInitialChatProjectionSlice,
  type ChatProjectionSlice,
  type ProjectionSession,
} from '@workspace/client-core/chat/types'
import { type ChatProjectionState } from '@/features/chat/state/chat-projection-store'
import {
  syncChatProjectionShellSnapshot,
  syncChatProjectionSessionDetailSnapshot,
} from '@workspace/client-core/chat/writers'

export const CHAT_PROJECTION_CACHE_STORAGE_KEY = 'platform.chat-projection'
const CHAT_PROJECTION_CACHE_VERSION = 4
const MAX_CACHE_BYTES = 1_048_576

const cachedTranscriptSchema = v.object({
  activities: v.array(orchestrationSessionActivitySchema),
  messages: v.array(orchestrationMessageSchema),
  sessionId: sessionIdSchema,
  checkpoints: v.array(orchestrationCheckpointSummarySchema),
  proposedPlans: v.array(orchestrationProposedPlanSchema),
  hasEarlier: v.boolean(),
})
const cachedSliceSchema = v.object({
  environmentId: environmentIdSchema,
  projects: v.array(orchestrationProjectShellSchema),
  worktrees: v.array(orchestrationWorktreeShellSchema),
  sessions: v.array(orchestrationSessionShellSchema),
  transcripts: v.array(cachedTranscriptSchema),
  updatedAt: v.string(),
})
const environmentBindingSchema = v.object({
  names: v.array(v.union([v.literal('local'), machineNameSchema])),
  origin: originMachineSchema.entries.url,
  descriptor: healthDescriptorSchema,
})

export type EnvironmentCacheBinding = Omit<
  v.InferOutput<typeof environmentBindingSchema>,
  'names'
> & {
  readonly names: readonly string[]
}

const cacheBindings = new Map<EnvironmentId, EnvironmentCacheBinding>()

const cachedProjectionSchema = v.object({
  binding: v.optional(environmentBindingSchema),
  slices: v.array(cachedSliceSchema),
  version: v.literal(CHAT_PROJECTION_CACHE_VERSION),
})

export type CachedChatProjection = v.InferOutput<typeof cachedProjectionSchema>
type CachedSlice = v.InferOutput<typeof cachedSliceSchema>

export function readChatProjectionCache(storage: ScopedStorage): CachedChatProjection | null {
  const cached = readWorkspaceCacheEntry<CachedChatProjection | null>(
    CHAT_PROJECTION_CACHE_STORAGE_KEY,
    cachedProjectionSchema,
    null,
    { storage, maxSerializedBytes: MAX_CACHE_BYTES },
  )
  if (!cached) return null
  if (cached.binding && cached.binding.descriptor.environmentId !== storage.environmentId)
    return invalidChatProjectionCache(storage)
  if (!cached.slices.every((slice) => slice.environmentId === storage.environmentId))
    return invalidChatProjectionCache(storage)
  if (cached.binding) cacheBindings.set(storage.environmentId, cached.binding)
  return cached
}

export function recordEnvironmentCacheBinding(
  storage: ScopedStorage,
  binding: EnvironmentCacheBinding,
) {
  if (binding.descriptor.environmentId !== storage.environmentId) return false
  const cached = readChatProjectionCache(storage)
  const previous = cached?.binding ?? cacheBindings.get(storage.environmentId)
  const names = [...new Set([...(previous?.names ?? []), ...binding.names])]
  const origin = previous?.names.includes('local') ? previous.origin : binding.origin
  cacheBindings.set(storage.environmentId, { ...binding, names, origin })
  return writeChatProjectionCache(
    storage,
    cached ?? { slices: [], version: CHAT_PROJECTION_CACHE_VERSION },
  )
}

export function readCachedEnvironmentBindings(
  names: readonly string[],
): readonly EnvironmentCacheBinding[] {
  const wanted = new Set(names)
  return storedEnvironmentScopes(CHAT_PROJECTION_CACHE_STORAGE_KEY).flatMap((storage) => {
    const binding = readChatProjectionCache(storage)?.binding
    if (!binding || !binding.names.some((name) => wanted.has(name))) return []
    return [binding]
  })
}

function invalidChatProjectionCache(storage: ScopedStorage): null {
  removeWorkspaceCacheEntry(CHAT_PROJECTION_CACHE_STORAGE_KEY, storage)
  return null
}

export function writeChatProjectionCache(storage: ScopedStorage, cached: CachedChatProjection) {
  if (
    cacheWithinBudget(cached, { bytes: MAX_CACHE_BYTES, items: 20_000 }) &&
    setCacheEntry(storage, cached)
  )
    return true
  const shellOnly = {
    ...cached,
    slices: cached.slices.map((slice) => ({ ...slice, transcripts: [] })),
  }
  if (
    cacheWithinBudget(shellOnly, { bytes: MAX_CACHE_BYTES, items: 20_000 }) &&
    setCacheEntry(storage, shellOnly)
  )
    return true
  removeWorkspaceCacheEntry(CHAT_PROJECTION_CACHE_STORAGE_KEY, storage)
  return false
}

function setCacheEntry(storage: ScopedStorage, cached: CachedChatProjection) {
  const result = writeWorkspaceCacheEntry(
    CHAT_PROJECTION_CACHE_STORAGE_KEY,
    {
      ...cached,
      binding: cacheBindings.get(storage.environmentId) ?? cached.binding,
      slices: cached.slices.filter((slice) => slice.environmentId === storage.environmentId),
    },
    { storage, maxSerializedBytes: MAX_CACHE_BYTES },
  )
  return result.status === 'written'
}

export function chatProjectionCacheFromState(state: ChatProjectionState): CachedChatProjection {
  return {
    slices: Object.entries(state.slices).map(([environmentId, slice]) => ({
      environmentId: v.parse(environmentIdSchema, environmentId),
      projects: slice.projectIds.flatMap((id) => slice.projectById[id] ?? []),
      worktrees: slice.worktreeIds.flatMap((id) => slice.worktreeById[id] ?? []),
      sessions: cachedShellSessions(slice, v.parse(environmentIdSchema, environmentId)),
      transcripts: cachedTranscripts(slice, v.parse(environmentIdSchema, environmentId)),
      updatedAt: slice.lastAppliedShellUpdatedAt ?? new Date().toISOString(),
    })),
    version: CHAT_PROJECTION_CACHE_VERSION,
  }
}

export function hydrateChatProjectionState(
  state: ChatProjectionState,
  cached: CachedChatProjection | null,
): ChatProjectionState {
  if (!cached) return state
  const slices = { ...state.slices }
  for (const cachedSlice of cached.slices)
    slices[cachedSlice.environmentId] = hydrateSlice(cachedSlice)
  return { slices }
}

function hydrateSlice(cached: CachedSlice): ChatProjectionSlice {
  let slice = syncChatProjectionShellSnapshot(createInitialChatProjectionSlice(), {
    projects: cached.projects,
    worktrees: cached.worktrees,
    sessions: cached.sessions,
    snapshotSequence: 0,
    updatedAt: cached.updatedAt,
  })
  for (const transcript of cached.transcripts) {
    const shell = cached.sessions.find((session) => session.id === transcript.sessionId)
    if (!shell) continue
    slice = syncChatProjectionSessionDetailSnapshot(slice, {
      checkpoints: transcript.checkpoints,
      proposedPlans: transcript.proposedPlans,
      snapshotSequence: 0,
      session: {
        ...shell,
        activities: transcript.activities,
        messages: transcript.messages,
        deletedAt: null,
        deletion: null,
      },
    })
  }
  return {
    ...slice,
    sessionHasEarlierById: Object.fromEntries(
      cached.transcripts.map((transcript) => [transcript.sessionId, transcript.hasEarlier]),
    ),
    sessionHistorySequenceById: {},
    bootstrapComplete: false,
    lastAppliedShellSequence: 0,
    lastAppliedShellUpdatedAt: null,
    sessionDetailSequenceById: {},
  }
}

function cachedShellSessions(
  slice: ChatProjectionSlice,
  environmentId: EnvironmentId,
): OrchestrationSessionShell[] {
  const visible = readTimelineReload(environmentId)?.sessionId
  return [...slice.sessionIds]
    .sort((left, right) => Number(right === visible) - Number(left === visible))
    .slice(0, CHAT_PROJECTION_CACHE_SESSION_LIMIT)
    .flatMap((id) => {
      const session = slice.sessionById[id]
      return session ? [shellFromProjection(session)] : []
    })
}

function shellFromProjection(session: ProjectionSession): OrchestrationSessionShell {
  const {
    detailSynced: _detail,
    liveTurn: _turn,
    metaSource: _source,
    runtimeKnown: _known,
    pendingSourceProposedPlan: _plan,
    ...shell
  } = session
  return shell
}

function cachedTranscripts(
  slice: ChatProjectionSlice,
  environmentId: EnvironmentId,
): CachedSlice['transcripts'] {
  const visible = readTimelineReload(environmentId)
  return slice.sessionIds
    .filter((id) => slice.sessionById[id]?.detailSynced)
    .toSorted(
      (left, right) =>
        Number(right === visible?.sessionId) - Number(left === visible?.sessionId) ||
        detailUpdatedAt(slice, right).localeCompare(detailUpdatedAt(slice, left)),
    )
    .slice(0, CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT)
    .map((sessionId) => {
      const ids = slice.messageIdsBySessionId[sessionId] ?? []
      const anchor =
        visible?.sessionId === sessionId && !visible.followEnd
          ? ids.findIndex((id) => visible.messageIds.includes(id))
          : -1
      const start =
        anchor < 0
          ? Math.max(0, ids.length - CHAT_PROJECTION_CACHE_MESSAGE_LIMIT)
          : Math.max(0, anchor - 5)
      const selected = ids.slice(start, start + CHAT_PROJECTION_CACHE_MESSAGE_LIMIT)
      return {
        activities: transcriptTail(
          slice.activityIdsBySessionId[sessionId],
          slice.activityBySessionId[sessionId],
          CHAT_PROJECTION_CACHE_ACTIVITY_LIMIT,
        ),
        messages: selected.flatMap((id) => slice.messageBySessionId[sessionId]?.[id] ?? []),
        checkpoints: prioritizedTranscriptItems(
          slice.turnDiffIdsBySessionId[sessionId],
          slice.turnDiffSummaryBySessionId[sessionId],
          40,
          (checkpoint) =>
            visible?.sessionId === sessionId &&
            checkpoint.assistantMessageId !== null &&
            visible.messageIds.includes(checkpoint.assistantMessageId),
        ),
        proposedPlans: prioritizedTranscriptItems(
          slice.proposedPlanIdsBySessionId[sessionId],
          slice.proposedPlanBySessionId[sessionId],
          40,
          (plan) =>
            visible?.sessionId === sessionId &&
            visible.rows.some((row) => row.id === `proposed-plan:${plan.id}`),
        ),
        hasEarlier: start > 0 || (slice.sessionHasEarlierById[sessionId] ?? true),
        sessionId,
      }
    })
}

function detailUpdatedAt(slice: ChatProjectionSlice, sessionId: SessionId) {
  return slice.sessionById[sessionId]?.updatedAt ?? ''
}

function transcriptTail<TId extends string, TValue>(
  ids: readonly TId[] | undefined,
  byId: Record<TId, TValue> | undefined,
  limit: number,
): TValue[] {
  if (!ids || !byId) return []
  return ids.slice(-limit).flatMap((id) => byId[id] ?? [])
}

function cacheWithinBudget(value: unknown, budget: { bytes: number; items: number }): boolean {
  budget.items -= 1
  if (budget.items < 0 || budget.bytes < 0) return false
  if (typeof value === 'string') budget.bytes -= value.length * 2 + 4
  if (value === null || typeof value !== 'object') return budget.bytes >= 0
  for (const [key, child] of Object.entries(value)) {
    budget.bytes -= key.length * 2 + 8
    if (!cacheWithinBudget(child, budget)) return false
  }
  return true
}

function prioritizedTranscriptItems<TId extends string, TValue>(
  ids: readonly TId[] | undefined,
  byId: Record<TId, TValue> | undefined,
  limit: number,
  visible: (value: TValue) => boolean,
): TValue[] {
  if (!ids || !byId) return []
  const prioritized = ids.filter((id) => byId[id] !== undefined && visible(byId[id]))
  const selected = new Set([...prioritized, ...ids.slice(-limit)].slice(0, limit))
  return ids.filter((id) => selected.has(id)).flatMap((id) => byId[id] ?? [])
}
