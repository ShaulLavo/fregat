import * as v from 'valibot'
import type { WorktreeId } from '@workspace/contracts'
import {
  normalizeTerminalContextSelection,
  type TerminalContextSelection,
} from '@workspace/client-core/chat/terminal-context'
import type { FileStorage } from '@/storage/files'
import { terminalContextSchema } from '@/agent-stage/utils/prompt'

export function queuePrompt(
  storage: FileStorage,
  worktreeId: WorktreeId,
  context: TerminalContextSelection,
) {
  const normalized = normalizeTerminalContextSelection(context)
  if (!normalized) return
  const key = `agent.inbox.worktree:${worktreeId}`
  storage.updateItem(key, (value) => {
    const contexts = value ? v.parse(v.array(terminalContextSchema), JSON.parse(value)) : []
    return JSON.stringify([...contexts, normalized])
  })
}

export function readInbox(storage: FileStorage, worktreeId: WorktreeId) {
  const value = storage.getItem(`agent.inbox.worktree:${worktreeId}`)
  return value ? v.parse(v.array(terminalContextSchema), JSON.parse(value)) : []
}
