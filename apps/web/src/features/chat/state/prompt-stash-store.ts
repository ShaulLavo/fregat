import type { EnvironmentId } from '@workspace/contracts'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import { createClientInvariantError } from '@/lib/structured-errors'
import { create } from 'zustand'
import { readPersistedChatInputDrafts, type PromptStashEntry } from '../utils/draft-storage'
import {
  commitComposerTransfer,
  type ChatInputDraft,
  type ChatInputDraftTarget,
} from './chat-input-draft-store'

export type { PromptStashEntry } from '../utils/draft-storage'
export const MAX_PROMPT_STASH_ENTRIES = 20
export type ComposedMessage = Pick<ChatInputDraft, 'prompt' | 'attachments' | 'terminalContexts'>
type Transfer = { target: ChatInputDraftTarget; expected: ChatInputDraft; content: ComposedMessage }
type PromptStashStore = {
  entries: readonly PromptStashEntry[]
  commit: (entries: PromptStashEntry[], transfer?: Transfer) => boolean
}

export function createPromptStashStore(storage: ScopedStorage) {
  return create<PromptStashStore>((set) => ({
    entries: readPersistedChatInputDrafts(storage).stashEntries,
    commit: (entries, transfer) => {
      if (!commitComposerTransfer(storage, entries, transfer)) return false
      set({ entries })
      return true
    },
  }))
}

const promptStashes = new Map<EnvironmentId, ReturnType<typeof createPromptStashStore>>()
export function initializePromptStashStore(storage: ScopedStorage) {
  if (!promptStashes.has(storage.environmentId))
    promptStashes.set(storage.environmentId, createPromptStashStore(storage))
}
export function promptStashStoreFor(environmentId: EnvironmentId) {
  const store = promptStashes.get(environmentId)
  if (store) return store
  throw createClientInvariantError('The machine prompt stash has not been initialized.')
}
export function resetPromptStashStore() {
  for (const store of promptStashes.values()) store.getState().commit([])
}
