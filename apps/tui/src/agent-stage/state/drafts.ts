import * as v from 'valibot'
import { isDeepStrictEqual } from 'node:util'
import {
  chatAttachmentUploadsSchema,
  interactionModeSchema,
  modelSelectionSchema,
  runtimeModeSchema,
  sessionTurnStartCommandSchema,
  type SessionTurnStartCommand,
  type CommandId,
  type WorktreeId,
} from '@workspace/contracts'
import type { FileStorage } from '@/storage/files'
import type { StageTarget } from '@/agent/utils/target'
import { createTuiError } from '@/host/utils/structured-errors'
import { promptElementSchema, terminalContextSchema } from '@/agent-stage/utils/prompt'
import { readInbox } from '@/agent-stage/state/inbox'

const draftSchema = v.object({
  text: v.string(),
  attachments: chatAttachmentUploadsSchema,
  modelSelection: v.nullable(modelSelectionSchema),
  runtimeMode: v.nullable(runtimeModeSchema),
  interactionMode: v.nullable(interactionModeSchema),
  worktreeMode: v.optional(v.picklist(['current', 'new']), 'current'),
  elements: v.optional(v.array(promptElementSchema), []),
  terminalContexts: v.optional(v.array(terminalContextSchema), []),
})
const pendingSchema = v.object({
  draft: draftSchema,
  intent: v.string(),
  command: sessionTurnStartCommandSchema,
})
export type ComposerDraft = v.InferOutput<typeof draftSchema>
const emptyDraft: ComposerDraft = {
  text: '',
  attachments: [],
  modelSelection: null,
  runtimeMode: null,
  interactionMode: null,
  worktreeMode: 'current',
  elements: [],
  terminalContexts: [],
}
export type Drafts = ReturnType<typeof createDrafts>
const owners = new WeakMap<FileStorage, Drafts>()

export function draftsForStorage(storage: FileStorage) {
  const existing = owners.get(storage)
  if (existing) return existing
  const drafts = createDrafts(storage)
  owners.set(storage, drafts)
  return drafts
}

export function draftKey(target: StageTarget) {
  if (target.kind === 'conversation') return `agent.draft.session:${target.sessionId}`
  return `agent.draft.worktree:${target.worktreeId}`
}

export function createDrafts(storage: FileStorage) {
  const drafts = new Map<string, ComposerDraft>()
  const listeners = new Set<() => void>()
  const historyCursors = new Map<string, { index: number; draft: ComposerDraft }>()
  let revision = 0
  function read(key: string): ComposerDraft {
    const cached = drafts.get(key)
    if (cached) return cached
    const stored = storage.getItem(key)
    const draft = stored ? parseDraft(stored) : emptyDraft
    drafts.set(key, draft)
    return draft
  }
  function write(key: string, draft: ComposerDraft) {
    storage.setItem(key, JSON.stringify(draft))
    drafts.set(key, draft)
    revision += 1
    for (const listener of listeners) listener()
  }
  return {
    read,
    pending(key: string, draft: ComposerDraft, intent: string) {
      const value = storage.getItem(`agent.pending:${key}`)
      if (!value) return null
      const parsed = v.safeParse(pendingSchema, JSON.parse(value))
      if (!parsed.success)
        throw createTuiError(
          'The saved prompt submission is invalid.',
          'Delete the invalid TUI state file and reconnect.',
        )
      if (
        parsed.output.intent !== intent ||
        !isDeepStrictEqual(parsed.output.draft, v.parse(draftSchema, draft))
      )
        return null
      return parsed.output.command
    },
    retain(key: string, draft: ComposerDraft, intent: string, command: SessionTurnStartCommand) {
      storage.setItem(`agent.pending:${key}`, JSON.stringify({ draft, intent, command }))
    },
    discardPending(key: string, commandId: CommandId) {
      storage.updateItem(`agent.pending:${key}`, (value) => {
        if (!value) return null
        const pending = v.parse(pendingSchema, JSON.parse(value))
        return pending.command.commandId === commandId ? null : value
      })
    },
    remember(draft: ComposerDraft, command: SessionTurnStartCommand) {
      const entries = storage.keys('agent.history:')
      if (entries.some((key) => key.endsWith(`:${command.commandId}`))) return
      storage.setItem(
        `agent.history:${entries.length.toString().padStart(12, '0')}:${command.commandId}`,
        JSON.stringify(draft),
      )
    },
    history(key: string, direction: -1 | 1) {
      const entries = storage.keys('agent.history:')
      const current = read(key)
      const cursor = historyCursors.get(key) ?? { index: entries.length, draft: current }
      const index = Math.max(0, Math.min(entries.length, cursor.index + direction))
      historyCursors.set(key, { ...cursor, index })
      if (index === entries.length)
        return write(key, { ...cursor.draft, worktreeMode: current.worktreeMode })
      const stored = storage.getItem(entries[index])
      if (stored) write(key, { ...parseDraft(stored), worktreeMode: current.worktreeMode })
    },
    takeInbox(key: string, worktreeId: WorktreeId) {
      const contexts = readInbox(storage, worktreeId)
      if (contexts.length === 0) return
      const draft = read(key)
      write(key, { ...draft, terminalContexts: [...(draft.terminalContexts ?? []), ...contexts] })
      storage.removeItem(`agent.inbox.worktree:${worktreeId}`)
    },
    update(key: string, change: Partial<ComposerDraft>) {
      const current = read(key)
      if (
        Object.entries(change).every(
          ([field, value]) =>
            Object.is(Reflect.get(current, field), value) ||
            isDeepStrictEqual(Reflect.get(current, field), value),
        )
      )
        return
      if (change.text !== undefined) historyCursors.delete(key)
      write(key, { ...current, ...change })
    },
    clearContent(key: string, sent: ComposerDraft) {
      const current = read(key)
      if (current !== sent) return
      const cleared: ComposerDraft = {
        ...current,
        text: '',
        attachments: [],
        elements: [],
        terminalContexts: [],
        worktreeMode: 'current',
      }
      storage.updateItem(key, (value) =>
        value && isDeepStrictEqual(parseDraft(value), v.parse(draftSchema, sent))
          ? JSON.stringify(cleared)
          : value,
      )
      drafts.delete(key)
      revision += 1
      for (const listener of listeners) listener()
    },
    stash(key: string) {
      const draft = read(key)
      if (!draft.text.trim() && draft.attachments.length === 0 && !draft.terminalContexts?.length)
        return
      storage.setItem(
        `agent.stash:${Date.now().toString().padStart(13, '0')}:${revision.toString().padStart(12, '0')}:${crypto.randomUUID()}`,
        JSON.stringify(draft),
      )
      write(key, { ...draft, text: '', attachments: [], elements: [], terminalContexts: [] })
    },
    pop(key: string) {
      const current = read(key)
      if (current.text.trim() || current.attachments.length > 0 || current.terminalContexts?.length)
        throw createTuiError(
          'The composer already has a draft.',
          'Stash or send it before restoring another prompt.',
        )
      const stash = storage.keys('agent.stash:').at(-1)
      if (!stash) return
      const stored = storage.getItem(stash)
      if (!stored) return
      write(key, parseDraft(stored))
      storage.removeItem(stash)
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => revision,
  }
}

function parseDraft(value: string) {
  try {
    return v.parse(draftSchema, JSON.parse(value))
  } catch (error) {
    throw createTuiError(
      'The saved chat draft is invalid.',
      'Delete the invalid TUI state file and reconnect.',
      error instanceof Error ? error : undefined,
    )
  }
}
