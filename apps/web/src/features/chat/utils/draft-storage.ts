import { persistedAttachmentDraftSchema } from './attachment-draft'
import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import type { EnvironmentId } from '@workspace/contracts'
import {
  interactionModeSchema,
  projectIdSchema,
  worktreeIdSchema,
  sessionAgentSchema,
  sessionWorktreeTargetSchema,
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

const composedMessageSchema = v.object({
  prompt: v.string(),
  attachments: v.array(persistedAttachmentDraftSchema),
  terminalContexts: v.array(persistedTerminalContextSchema),
})
const promptStashEntrySchema = v.object({
  ...composedMessageSchema.entries,
  createdAt: v.string(),
  id: trimmedNonEmptyStringSchema,
})
export type PromptStashEntry = v.InferOutput<typeof promptStashEntrySchema>

const draftIdentitySchema = v.object({
  id: v.pipe(v.string(), v.uuid()),
  projectId: projectIdSchema,
  rootPath: v.string(),
  baseWorktreeId: worktreeIdSchema,
  worktreeTarget: sessionWorktreeTargetSchema,
  /** The agent definition the new session runs as; null runs the harness default. */
  agent: v.optional(v.nullable(sessionAgentSchema)),
  createdAt: v.string(),
})
export type DraftIdentity = v.InferOutput<typeof draftIdentitySchema>

const persistedChatInputDraftSchema = v.object({
  identity: v.optional(v.nullable(draftIdentitySchema), null),
  attachments: v.optional(v.array(persistedAttachmentDraftSchema), []),
  interactionMode: v.optional(v.nullable(interactionModeSchema), null),
  modelSelection: v.optional(v.nullable(modelSelectionSchema), null),
  /** A new draft sent to several models: the ones besides `modelSelection`. */
  additionalModelSelections: v.optional(v.array(modelSelectionSchema), []),
  prompt: v.optional(v.string(), ''),
  runtimeMode: v.optional(v.nullable(runtimeModeSchema), null),
  terminalContexts: v.optional(v.array(persistedTerminalContextSchema), []),
  updatedAt: v.optional(v.nullable(v.string()), null),
})

const persistedChatInputDraftStorageSchema = v.object({
  stashEntries: v.optional(v.array(promptStashEntrySchema), []),
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
    stashEntries: [],
    draftsByKey: {},
    version: CHAT_INPUT_DRAFT_STORAGE_VERSION,
  }
}
