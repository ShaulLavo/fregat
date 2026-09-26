import * as v from 'valibot'
import type { WorktreeId } from '@workspace/contracts'
import { recordObservabilityWarning } from '@workspace/observability'
import {
  normalizeTerminalContextSelection,
  type TerminalContextSelection,
} from '@workspace/client-core/chat/terminal-context'
import type { FileStorage } from '@/storage/files'
import { terminalContextSchema } from '@workspace/client-core/chat/terminal-context'

export function queuePrompt(
  storage: FileStorage,
  worktreeId: WorktreeId,
  context: TerminalContextSelection,
) {
  const normalized = normalizeTerminalContextSelection(context)
  if (!normalized) return
  const key = `agent.inbox.worktree:${worktreeId}`
  storage.updateItem(key, (value) => {
    const contexts = readContexts(storage, key, value)
    return JSON.stringify([...contexts, normalized])
  })
}

export function readInbox(storage: FileStorage, worktreeId: WorktreeId) {
  const key = `agent.inbox.worktree:${worktreeId}`
  return readContexts(storage, key, storage.getItem(key))
}

function readContexts(storage: FileStorage, key: string, raw: string | null) {
  let current = raw
  while (current !== null) {
    const contexts = readContextsValue(storage, key, current)
    if (contexts !== null) return contexts
    current = storage.getItem(key)
  }
  return []
}

function readContextsValue(storage: FileStorage, key: string, raw: string) {
  try {
    return v.parse(v.array(terminalContextSchema), JSON.parse(raw))
  } catch {
    if (!storage.removeItemIfValue(key, raw)) return null
    recordObservabilityWarning('tui.storage.read', {
      area: 'storage',
      storageKey: key,
      outcome: 'discarded',
    })
    return []
  }
}
