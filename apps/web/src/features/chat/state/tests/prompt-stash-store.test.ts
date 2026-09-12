import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { memoryLocalStorage } from '../../../../../test/factories/local-storage'
import { afterEach, beforeEach, vi } from 'vitest'
import {
  MAX_PROMPT_STASH_ENTRIES,
  resetPromptStashStore,
  promptStashStoreFor,
  initializePromptStashStore,
  createPromptStashStore,
} from '@/features/chat/state/prompt-stash-store'
import { expect, test } from '../../../../../test/fixtures'

beforeEach(() => vi.stubGlobal('localStorage', memoryLocalStorage()))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function stash() {
  return promptStashStoreFor(testScopedStorage.environmentId).getState()
}

test('a stashed prompt comes back exactly as it was typed, and only once', () => {
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()

  const entry = stash().stashPrompt('  rewrite the ingestion reactor  ')
  expect(entry?.prompt).toBe('rewrite the ingestion reactor')
  expect(stash().entries).toHaveLength(1)

  const restored = stash().takeEntry(entry?.id ?? '')
  expect(restored?.prompt).toBe('rewrite the ingestion reactor')
  // Restoring is spending it: the prompt now lives in the composer, and a queue
  // that kept its own copy would hand back a duplicate on the next restore.
  expect(stash().entries).toEqual([])
  expect(stash().takeEntry(entry?.id ?? '')).toBeNull()
})

test('the newest stash is first in the queue', () => {
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()

  stash().stashPrompt('first')
  stash().stashPrompt('second')

  expect(stash().entries.map((entry) => entry.prompt)).toEqual(['second', 'first'])
})

test('an empty composer stashes nothing', () => {
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()

  expect(stash().stashPrompt('   \n  ')).toBeNull()
  expect(stash().entries).toEqual([])
})

test('the queue evicts the oldest prompt rather than growing without bound', () => {
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()

  for (let index = 0; index <= MAX_PROMPT_STASH_ENTRIES; index += 1) {
    stash().stashPrompt(`prompt ${index}`)
  }

  const entries = stash().entries
  expect(entries).toHaveLength(MAX_PROMPT_STASH_ENTRIES)
  expect(entries[0]?.prompt).toBe(`prompt ${MAX_PROMPT_STASH_ENTRIES}`)
  expect(entries.some((entry) => entry.prompt === 'prompt 0')).toBe(false)
})

test('deleting a stashed prompt drops it without handing it back', () => {
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()

  const entry = stash().stashPrompt('abandoned idea')
  stash().removeEntry(entry?.id ?? '')

  expect(stash().entries).toEqual([])
})

test('a quota failure leaves the prompt in the composer and the stash unchanged', () => {
  const store = createPromptStashStore(testScopedStorage)
  const previous = store.getState().stashPrompt('already saved')
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
  })

  expect(store.getState().stashPrompt('keep in composer')).toBeNull()
  expect(store.getState().entries).toEqual([previous])
  expect(createPromptStashStore(testScopedStorage).getState().entries).toEqual([previous])
})

test('an unavailable store cannot report a prompt as saved', () => {
  vi.stubGlobal('localStorage', undefined)
  const store = createPromptStashStore(testScopedStorage)

  expect(store.getState().stashPrompt('keep in composer')).toBeNull()
  expect(store.getState().entries).toEqual([])
})
