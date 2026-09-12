import { createScopedRecordStorage } from '@/features/chat/utils/scoped-record-storage'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { turnIdSchema, type TurnId } from '@workspace/contracts'
import * as v from 'valibot'

export const SESSION_DIFF_SCOPE_STORAGE_KEY = 'platform.chat-session-diff-scope.v1'
const SESSION_DIFF_SCOPE_STORAGE_VERSION = 2

/**
 * Nothing deletes an entry when a session goes away, so the map is bounded here
 * and the least recently touched picks fall off the end. Losing one costs the
 * user a pane that opens on the branch diff instead of the turn they left it on.
 */
export const SESSION_DIFF_SCOPE_LIMIT = 200

/**
 * The branch diff is deliberately not a variant. The server answers
 * `/git/branch-diff`, but nothing on the client renders it, so a scope for it
 * could only ever persist a pick the pane cannot honour.
 */
const sessionDiffScopeSchema = v.variant('kind', [
  v.object({ kind: v.literal('working-tree') }),
  v.object({
    filePath: v.nullable(v.string()),
    kind: v.literal('turn'),
    turnId: turnIdSchema,
  }),
])

const persistedEntrySchema = v.object({
  scope: sessionDiffScopeSchema,
  updatedAt: v.number(),
})

const persistedStorageSchema = v.object({
  scopeBySessionKey: v.record(v.string(), persistedEntrySchema),
  version: v.literal(SESSION_DIFF_SCOPE_STORAGE_VERSION),
})

export type SessionDiffScope = v.InferOutput<typeof sessionDiffScopeSchema>
export type PersistedSessionDiffScopeEntry = v.InferOutput<typeof persistedEntrySchema>
export type PersistedSessionDiffScopeStorage = v.InferOutput<typeof persistedStorageSchema>

/**
 * What a session with no remembered pick shows — the same working-tree panel the
 * git tab has always opened on, so a session nobody has chosen for behaves the
 * way it did before it could be chosen for.
 */
export const DEFAULT_SESSION_DIFF_SCOPE: SessionDiffScope = { kind: 'working-tree' }

const recordStorage = createScopedRecordStorage<PersistedSessionDiffScopeEntry>({
  key: SESSION_DIFF_SCOPE_STORAGE_KEY,
  limit: SESSION_DIFF_SCOPE_LIMIT,
  recordKey: 'scopeBySessionKey',
  schema: v.pipe(
    persistedStorageSchema,
    v.transform((stored) => stored.scopeBySessionKey),
  ),
  version: SESSION_DIFF_SCOPE_STORAGE_VERSION,
})

export function readPersistedSessionDiffScopes(
  storage: ScopedStorage,
): PersistedSessionDiffScopeStorage {
  return {
    scopeBySessionKey: recordStorage.read(storage),
    version: SESSION_DIFF_SCOPE_STORAGE_VERSION,
  }
}

export const writePersistedSessionDiffScopes = recordStorage.write
export const pruneSessionDiffScopes = recordStorage.prune
export const nextSessionDiffScopeStamp = recordStorage.nextStamp

/**
 * The reason this state is stored rather than derived: reverting to a checkpoint
 * deletes every checkpoint after it, so a remembered "turn 7" routinely names a
 * turn that no longer exists. Returns the scope to move to, or `null` when the
 * stored one still stands.
 *
 * `availableTurnIds` is the session's own checkpoint order, oldest first — the
 * same order the projection keeps them in. A revert only ever drops a suffix, so
 * the survivors are a prefix and the last of them is the nearest turn to the one
 * that went away.
 */
export function reconcileSessionDiffScope(
  scope: SessionDiffScope,
  availableTurnIds: readonly TurnId[],
): SessionDiffScope | null {
  if (scope.kind !== 'turn') return null
  // Empty means "the session detail has not arrived", not "this session has no
  // turns": reconciling against it would throw the remembered pick away on every
  // cold start, before the subscription has had a chance to answer.
  if (availableTurnIds.length === 0) return null
  if (availableTurnIds.includes(scope.turnId)) return null

  const nearestTurnId = availableTurnIds.at(-1)
  if (!nearestTurnId) return null

  // The file is deliberately dropped rather than carried over: nothing says the
  // surviving turn touched it, and a path with no hunks renders as "no changes",
  // which reads as a broken pane instead of the reconcile it actually is.
  return { filePath: null, kind: 'turn', turnId: nearestTurnId }
}
