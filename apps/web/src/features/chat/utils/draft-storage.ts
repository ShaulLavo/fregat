import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type { EnvironmentId } from '@workspace/contracts'
import {
  interactionModeSchema,
  modelSelectionSchema,
  runtimeModeSchema,
  trimmedNonEmptyStringSchema,
} from '@workspace/contracts'
import * as v from 'valibot'

export const CHAT_INPUT_DRAFT_STORAGE_KEY = 'platform.chat-input-drafts.v1'
const CHAT_INPUT_DRAFT_STORAGE_VERSION = 2

/**
 * The whole capture, not a rendered label: a restored draft has to be able to
 * rebuild both the composer chip and the `<terminal_context>` block it sends.
 */
const lineNumberSchema = v.pipe(v.number(), v.integer(), v.minValue(1))
const persistedTerminalContextSchema = v.object({
  id: trimmedNonEmptyStringSchema,
  lineEnd: lineNumberSchema,
  lineStart: lineNumberSchema,
  source: trimmedNonEmptyStringSchema,
  text: trimmedNonEmptyStringSchema,
})

// Image attachments are deliberately absent: a draft is text-sized state, and a
// couple of pasted screenshots serialize to megabytes of base64 that blow the
// ~5 MB localStorage quota. The failed write took the whole text draft with it,
// so image bytes stay in memory only and stored attachments are not restored.
// `v.object` ignores unknown entries, so drafts written by the old schema still
// parse — their `images` array is stripped instead of rehydrated.
const persistedChatInputDraftSchema = v.object({
  interactionMode: v.optional(v.nullable(interactionModeSchema), null),
  modelSelection: v.optional(v.nullable(modelSelectionSchema), null),
  prompt: v.optional(v.string(), ''),
  runtimeMode: v.optional(v.nullable(runtimeModeSchema), null),
  terminalContexts: v.optional(v.array(persistedTerminalContextSchema), []),
  updatedAt: v.optional(v.nullable(v.string()), null),
})

const persistedChatInputDraftStorageSchema = v.object({
  draftsByKey: v.record(v.string(), persistedChatInputDraftSchema),
  version: v.literal(CHAT_INPUT_DRAFT_STORAGE_VERSION),
})

export type PersistedChatInputDraft = v.InferOutput<typeof persistedChatInputDraftSchema>
export type PersistedChatInputDraftStorage = v.InferOutput<
  typeof persistedChatInputDraftStorageSchema
>

export function chatInputDraftStorageId(
  environmentId: EnvironmentId,
  rootPath: string,
  draftKey: string | null,
) {
  if (!draftKey) return null

  return `${environmentId}:${encodeURIComponent(rootPath)}:${draftKey}`
}

export function readPersistedChatInputDrafts(
  storage: ScopedStorage,
): PersistedChatInputDraftStorage {
  return readWorkspaceCacheEntry(
    CHAT_INPUT_DRAFT_STORAGE_KEY,
    persistedChatInputDraftStorageSchema,
    emptyPersistedChatInputDrafts(),
    { storage },
  )
}

export function writePersistedChatInputDrafts(
  adapter: ScopedStorage,
  storage: PersistedChatInputDraftStorage,
) {
  return writeWorkspaceCacheEntry(CHAT_INPUT_DRAFT_STORAGE_KEY, storage, { storage: adapter })
}

export function emptyPersistedChatInputDrafts(): PersistedChatInputDraftStorage {
  return {
    draftsByKey: {},
    version: CHAT_INPUT_DRAFT_STORAGE_VERSION,
  }
}
