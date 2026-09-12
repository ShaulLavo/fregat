import { readWorkspaceCacheEntry, writeWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { EnvironmentId } from '@workspace/contracts'
import { createClientInvariantError } from '@/lib/structured-errors'
import type { ScopedStorage } from '@/lib/environments/state/scoped-storage'
import * as v from 'valibot'
import { create } from 'zustand'

/**
 * Prompts the user parked with ⌘S so they could type something else first. The
 * queue is deliberately text-only and provider-agnostic: the point of stashing
 * is to move a prompt to another session or another model, so nothing about the
 * model it was typed against travels with it.
 */
const PROMPT_STASH_STORAGE_KEY = 'platform.prompt-stash.v1'

/** Newest first, oldest evicted. Deep enough to park a morning's worth of ideas. */
export const MAX_PROMPT_STASH_ENTRIES = 20

const stashEntrySchema = v.object({
  createdAt: v.string(),
  id: v.pipe(v.string(), v.minLength(1)),
  prompt: v.pipe(v.string(), v.minLength(1)),
})

const stashStorageSchema = v.object({ entries: v.array(stashEntrySchema) })

export type PromptStashEntry = v.InferOutput<typeof stashEntrySchema>

type PromptStashStore = {
  entries: readonly PromptStashEntry[]
  /** Drops an entry without restoring it. */
  removeEntry: (entryId: string) => void
  /**
   * Prepends a prompt to the queue. Returns the entry, or `null` when there was
   * nothing to stash or the write failed outright — the composer is cleared on
   * the strength of this landing, so a failed write must not report success.
   */
  stashPrompt: (prompt: string) => PromptStashEntry | null
  /** Removes and returns an entry: restoring one is also spending it. */
  takeEntry: (entryId: string) => PromptStashEntry | null
}

function readPersistedEntries(storage: ScopedStorage): readonly PromptStashEntry[] {
  const stored = readWorkspaceCacheEntry<v.InferOutput<typeof stashStorageSchema> | null>(
    PROMPT_STASH_STORAGE_KEY,
    stashStorageSchema,
    null,
    { storage },
  )
  return stored?.entries ?? []
}

// The composer clears only after this synchronous write succeeds.
function writeEntries(storage: ScopedStorage, entries: readonly PromptStashEntry[]) {
  return (
    writeWorkspaceCacheEntry(PROMPT_STASH_STORAGE_KEY, { entries }, { storage }).status ===
    'written'
  )
}

export function createPromptStashStore(storage: ScopedStorage) {
  let entrySequence = 0
  return create<PromptStashStore>((set, get) => ({
    entries: readPersistedEntries(storage),
    removeEntry: (entryId) => {
      const entries = get().entries
      const next = entries.filter((entry) => entry.id !== entryId)
      if (next.length === entries.length) return

      writeEntries(storage, next)
      set({ entries: next })
    },
    stashPrompt: (prompt) => {
      const trimmed = prompt.trim()
      if (!trimmed) return null

      entrySequence += 1
      const entry: PromptStashEntry = {
        createdAt: new Date().toISOString(),
        id: `stash-${Date.now()}-${entrySequence}`,
        prompt: trimmed,
      }
      const next = [entry, ...get().entries].slice(0, MAX_PROMPT_STASH_ENTRIES)
      // A rejected write must leave nothing behind: the caller keeps the composer
      // intact on failure, and a visible-but-unwritten entry would duplicate it.
      if (!writeEntries(storage, next)) return null

      set({ entries: next })

      return entry
    },
    takeEntry: (entryId) => {
      const entries = get().entries
      const entry = entries.find((candidate) => candidate.id === entryId)
      if (!entry) return null

      const next = entries.filter((candidate) => candidate.id !== entryId)
      writeEntries(storage, next)
      set({ entries: next })

      return entry
    },
  }))
}

const promptStashes = new Map<EnvironmentId, ReturnType<typeof createPromptStashStore>>()

export function initializePromptStashStore(storage: ScopedStorage) {
  if (promptStashes.has(storage.environmentId)) return
  promptStashes.set(storage.environmentId, createPromptStashStore(storage))
}

export function promptStashStoreFor(environmentId: EnvironmentId) {
  const store = promptStashes.get(environmentId)
  if (store) return store
  throw createClientInvariantError('The machine prompt stash has not been initialized.')
}

export function resetPromptStashStore() {
  for (const store of promptStashes.values()) {
    for (const entry of store.getState().entries) store.getState().removeEntry(entry.id)
  }
}
