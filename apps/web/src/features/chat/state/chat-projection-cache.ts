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
const CHAT_PROJECTION_CACHE_VERSION = 3

const cachedTranscriptSchema = v.object({
  activities: v.array(orchestrationSessionActivitySchema),
  messages: v.array(orchestrationMessageSchema),
  sessionId: sessionIdSchema,
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
  try {
    const raw = storage.getItem(CHAT_PROJECTION_CACHE_STORAGE_KEY)
    if (!raw) return null
    const parsed = v.safeParse(cachedProjectionSchema, JSON.parse(raw))
    if (!parsed.success) return invalidChatProjectionCache(storage)
    const cached = parsed.output
    if (cached.binding && cached.binding.descriptor.environmentId !== storage.environmentId)
      return invalidChatProjectionCache(storage)
    if (!cached.slices.every((slice) => slice.environmentId === storage.environmentId))
      return invalidChatProjectionCache(storage)
    if (cached.binding) cacheBindings.set(storage.environmentId, cached.binding)
    return cached
  } catch {
    removeChatProjectionCache(storage)
    return null
  }
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
  removeChatProjectionCache(storage)
  return null
}

export function writeChatProjectionCache(storage: ScopedStorage, cached: CachedChatProjection) {
  if (setCacheEntry(storage, cached)) return true
  const shellOnly = {
    ...cached,
    slices: cached.slices.map((slice) => ({ ...slice, transcripts: [] })),
  }
  if (setCacheEntry(storage, shellOnly)) return true
  removeChatProjectionCache(storage)
  return false
}

function setCacheEntry(storage: ScopedStorage, cached: CachedChatProjection) {
  try {
    const status = storage.setItem(
      CHAT_PROJECTION_CACHE_STORAGE_KEY,
      JSON.stringify({
        ...cached,
        binding: cacheBindings.get(storage.environmentId) ?? cached.binding,
        slices: cached.slices.filter((slice) => slice.environmentId === storage.environmentId),
      }),
    )
    return status === 'written'
  } catch {
    return false
  }
}

function removeChatProjectionCache(storage: ScopedStorage) {
  try {
    storage.removeItem(CHAT_PROJECTION_CACHE_STORAGE_KEY)
  } catch {
    return
  }
}

export function chatProjectionCacheFromState(state: ChatProjectionState): CachedChatProjection {
  return {
    slices: Object.entries(state.slices).map(([environmentId, slice]) => ({
      environmentId: v.parse(environmentIdSchema, environmentId),
      projects: slice.projectIds.flatMap((id) => slice.projectById[id] ?? []),
      worktrees: slice.worktreeIds.flatMap((id) => slice.worktreeById[id] ?? []),
      sessions: cachedShellSessions(slice),
      transcripts: cachedTranscripts(slice),
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
      checkpoints: [],
      proposedPlans: [],
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
    bootstrapComplete: false,
    lastAppliedShellSequence: 0,
    lastAppliedShellUpdatedAt: null,
    sessionDetailSequenceById: {},
  }
}

function cachedShellSessions(slice: ChatProjectionSlice): OrchestrationSessionShell[] {
  return slice.sessionIds.slice(0, CHAT_PROJECTION_CACHE_SESSION_LIMIT).flatMap((id) => {
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

function cachedTranscripts(slice: ChatProjectionSlice): CachedSlice['transcripts'] {
  return slice.sessionIds
    .filter((id) => slice.sessionById[id]?.detailSynced)
    .toSorted((left, right) =>
      detailUpdatedAt(slice, right).localeCompare(detailUpdatedAt(slice, left)),
    )
    .slice(0, CHAT_PROJECTION_CACHE_TRANSCRIPT_LIMIT)
    .map((sessionId) => ({
      activities: transcriptTail(
        slice.activityIdsBySessionId[sessionId],
        slice.activityBySessionId[sessionId],
        CHAT_PROJECTION_CACHE_ACTIVITY_LIMIT,
      ),
      messages: transcriptTail(
        slice.messageIdsBySessionId[sessionId],
        slice.messageBySessionId[sessionId],
        CHAT_PROJECTION_CACHE_MESSAGE_LIMIT,
      ),
      sessionId,
    }))
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
