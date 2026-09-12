import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import * as v from 'valibot'

import type { SessionSeenStamps } from '@workspace/client-core/chat/rail/unread'

const SESSION_READ_STORAGE_KEY = 'platform.chat-session-reads.v1'
const SESSION_READ_STORAGE_VERSION = 1
/**
 * Nothing prunes stamps for sessions that were deleted elsewhere, so the record is
 * bounded here instead. Newest completions win: the oldest stamps belong to sessions
 * nobody has touched in weeks, and losing one only makes that row read as unread once.
 */
const MAX_SESSION_READ_ENTRIES = 300

const persistedSessionReadsSchema = v.object({
  seenBySessionKey: v.record(v.string(), v.string()),
  version: v.literal(SESSION_READ_STORAGE_VERSION),
})

export function readPersistedSessionReads(storage: ScopedStorage): SessionSeenStamps {
  const stored = readWorkspaceCacheEntry<v.InferOutput<typeof persistedSessionReadsSchema> | null>(
    SESSION_READ_STORAGE_KEY,
    persistedSessionReadsSchema,
    null,
    { storage },
  )
  return stored?.seenBySessionKey ?? {}
}

export function writePersistedSessionReads(
  storage: ScopedStorage,
  seenBySessionKey: SessionSeenStamps,
) {
  return writeWorkspaceCacheEntry(
    SESSION_READ_STORAGE_KEY,
    {
      seenBySessionKey: prunedSessionReads(seenBySessionKey),
      version: SESSION_READ_STORAGE_VERSION,
    },
    { storage },
  )
}

function prunedSessionReads(seenBySessionKey: SessionSeenStamps): SessionSeenStamps {
  const entries = Object.entries(seenBySessionKey).flatMap(([sessionId, seenAt]) =>
    seenAt ? [[sessionId, seenAt] as const] : [],
  )
  if (entries.length <= MAX_SESSION_READ_ENTRIES) return seenBySessionKey

  return Object.fromEntries(
    entries
      .toSorted(([, left], [, right]) => right.localeCompare(left))
      .slice(0, MAX_SESSION_READ_ENTRIES),
  )
}
