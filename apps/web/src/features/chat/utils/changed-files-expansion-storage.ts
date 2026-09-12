import { createScopedRecordStorage } from '@/features/chat/utils/scoped-record-storage'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import * as v from 'valibot'

export const CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY = 'platform.chat-changed-files-expansion.v1'
const CHAT_CHANGED_FILES_EXPANSION_STORAGE_VERSION = 1

/**
 * Nothing ever deletes an entry: a session can be removed while the expansion of
 * its cards sits in localStorage forever. The map is bounded here instead — the
 * least recently touched entries fall off the end, and re-collapsing a card the
 * user has not seen in a thousand turns is not a bug worth carrying state for.
 */
export const CHAT_CHANGED_FILES_EXPANSION_LIMIT = 200

/**
 * `null` is not "collapsed": it means the user never said, which is what lets
 * the card fall back to its auto-expand heuristic instead of latching closed.
 */
const persistedExpansionSchema = v.object({
  cardExpanded: v.nullable(v.boolean()),
  directoriesExpanded: v.nullable(v.boolean()),
  updatedAt: v.number(),
})

const persistedExpansionStorageSchema = v.object({
  expansionByKey: v.record(v.string(), persistedExpansionSchema),
  version: v.literal(CHAT_CHANGED_FILES_EXPANSION_STORAGE_VERSION),
})

export type PersistedChatChangedFilesExpansion = v.InferOutput<typeof persistedExpansionSchema>
export type PersistedChatChangedFilesExpansionStorage = v.InferOutput<
  typeof persistedExpansionStorageSchema
>

const recordStorage = createScopedRecordStorage<PersistedChatChangedFilesExpansion>({
  key: CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY,
  limit: CHAT_CHANGED_FILES_EXPANSION_LIMIT,
  recordKey: 'expansionByKey',
  schema: v.pipe(
    persistedExpansionStorageSchema,
    v.transform((stored) => stored.expansionByKey),
  ),
  version: CHAT_CHANGED_FILES_EXPANSION_STORAGE_VERSION,
})

export function readPersistedChatChangedFilesExpansion(
  storage: ScopedStorage,
): PersistedChatChangedFilesExpansionStorage {
  return {
    expansionByKey: recordStorage.read(storage),
    version: CHAT_CHANGED_FILES_EXPANSION_STORAGE_VERSION,
  }
}

export const writePersistedChatChangedFilesExpansion = recordStorage.write
export const pruneChatChangedFilesExpansion = recordStorage.prune
export const nextChatChangedFilesExpansionStamp = recordStorage.nextStamp
