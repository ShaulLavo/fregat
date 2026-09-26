import { afterEach, beforeEach, vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import { memoryLocalStorage } from '../../../../../test/factories/local-storage'
import {
  initializePromptStashStore,
  promptStashStoreFor,
  resetPromptStashStore,
  createPromptStashStore,
} from '../prompt-stash-store'
import {
  hydrateChatInputDraftStoreFromStorage,
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '../chat-input-draft-store'
import { transferStash } from '../stash-transfer'
import { readPersistedChatInputDrafts } from '../../utils/draft-storage'
import {
  addReviewComment,
  resetReviewDraftStore,
  useReviewDraftStore,
} from '@/lib/review-draft/state/store'

const target = {
  environmentId: testScopedStorage.environmentId,
  rootPath: '/repo',
  draftKey: 'stash-test',
}
const drafts = () => useChatInputDraftStore.getState()
const stash = () => promptStashStoreFor(target.environmentId).getState()
beforeEach(() => {
  vi.stubGlobal('localStorage', memoryLocalStorage())
  resetChatInputDraftStore()
  hydrateChatInputDraftStoreFromStorage(testScopedStorage)
  initializePromptStashStore(testScopedStorage)
  resetPromptStashStore()
  resetReviewDraftStore()
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test('one persisted transaction moves exact prompt and terminal context, then swaps them back', async () => {
  drafts().setPrompt(target, '  explain output  ')
  drafts().addTerminalContexts(target, [
    { id: 'capture', source: 'shell', lineStart: 1, lineEnd: 2, text: 'two lines' },
  ])
  const write = vi.spyOn(localStorage, 'setItem')
  await transferStash(target, { kind: 'stash' })
  expect(write).toHaveBeenCalledTimes(1)
  expect(drafts().getDraft(target).terminalContexts).toEqual([])
  const entry = stash().entries[0]!
  expect(entry.prompt).toBe('  explain output  ')
  expect(entry.terminalContexts[0]?.text).toBe('two lines')
  drafts().setPrompt(target, 'other work')
  await transferStash(target, { kind: 'restore', entry })
  expect(drafts().getDraft(target).prompt).toBe(entry.prompt)
  expect(drafts().getDraft(target).terminalContexts).toEqual(entry.terminalContexts)
  expect(stash().entries.map((item) => item.prompt)).toEqual(['other work'])
  expect(readPersistedChatInputDrafts(testScopedStorage).stashEntries).toEqual(stash().entries)
})

test('quota failure preserves both draft and stash during restore and removal', async () => {
  drafts().setPrompt(target, 'saved')
  await transferStash(target, { kind: 'stash' })
  const entry = stash().entries[0]!
  drafts().setPrompt(target, 'keep')
  vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw new DOMException('quota', 'QuotaExceededError')
  })
  await expect(transferStash(target, { kind: 'restore', entry })).rejects.toThrow()
  await expect(transferStash(target, { kind: 'remove', entry })).rejects.toThrow()
  expect(drafts().getDraft(target).prompt).toBe('keep')
  expect(stash().entries).toEqual([entry])
  expect(createPromptStashStore(testScopedStorage).getState().entries).toEqual([entry])
})

test('preparation blocks repeated shortcuts and context-only drafts can be stashed', async () => {
  drafts().addTerminalContexts(target, [
    { id: 'capture', source: 'shell', lineStart: 1, lineEnd: 1, text: 'output' },
  ])
  drafts().changeAttachmentPreparation(target, 1)
  await expect(transferStash(target, { kind: 'stash' })).rejects.toThrow()
  expect(stash().entries).toEqual([])
  drafts().changeAttachmentPreparation(target, -1)
  await transferStash(target, { kind: 'stash' })
  await transferStash(target, { kind: 'stash' })
  expect(stash().entries).toHaveLength(1)
})

test('stash writes preserve unrelated composed drafts', async () => {
  const other = { ...target, draftKey: 'other' }
  drafts().setPrompt(other, 'untouched')
  drafts().setPrompt(target, 'moving')
  await transferStash(target, { kind: 'stash' })
  const stored = readPersistedChatInputDrafts(testScopedStorage)
  expect(Object.values(stored.draftsByKey).map((item) => item.prompt)).toEqual(['untouched'])
})

test('a stashed message takes its review comments and quoted replies, and restoring returns them', async () => {
  drafts().setPrompt(target, 'fix both')
  const comment = addReviewComment({
    anchor: { kind: 'message', lines: { end: 2, start: 1 }, messageId: 'm-1', sessionId: 's-1' },
    author: 'user',
    body: 'this part',
    destination: { environmentId: target.environmentId, rootPath: '/repo' },
    quote: 'About your earlier reply, lines 1–2:\n\n> one\n> two',
  })
  await transferStash(target, { kind: 'stash' })
  expect(useReviewDraftStore.getState().comments).toEqual([])
  const entry = stash().entries[0]!
  expect(entry.reviewComments).toEqual([
    { anchor: comment.anchor, author: 'user', body: 'this part', quote: comment.quote },
  ])
  expect(readPersistedChatInputDrafts(testScopedStorage).stashEntries[0]?.reviewComments).toEqual(
    entry.reviewComments,
  )

  await transferStash(target, { kind: 'restore', entry })
  expect(useReviewDraftStore.getState().comments).toMatchObject([
    {
      anchor: comment.anchor,
      body: 'this part',
      destination: { environmentId: target.environmentId, rootPath: '/repo' },
    },
  ])
})

test('a draft holding only review comments can be stashed', async () => {
  addReviewComment({
    anchor: { kind: 'plan', lines: { end: 1, start: 1 }, planId: 'plan-1', sessionId: 's-1' },
    author: 'user',
    body: 'rename',
    destination: { environmentId: target.environmentId, rootPath: '/repo' },
    quote: 'About the proposed plan, line 1:\n\n> Step',
  })
  expect(await transferStash(target, { kind: 'stash' })).not.toBeNull()
  expect(stash().entries).toHaveLength(1)
})

test('restoring over a commented draft swaps both drafts with their own review comments', async () => {
  const destination = { environmentId: target.environmentId, rootPath: '/repo' }
  const commentOn = (sessionId: string, body: string) =>
    addReviewComment({
      anchor: { kind: 'message', lines: { end: 1, start: 1 }, messageId: 'm', sessionId },
      author: 'user',
      body,
      destination,
      quote: '> line',
    })
  const bodies = () => useReviewDraftStore.getState().comments.map((comment) => comment.body)

  drafts().setPrompt(target, 'draft A')
  commentOn('s-a', 'comment A')
  await transferStash(target, { kind: 'stash' })
  drafts().setPrompt(target, 'draft B')
  commentOn('s-b', 'comment B')

  await transferStash(target, { kind: 'restore', entry: stash().entries[0]! })
  expect(drafts().getDraft(target).prompt).toBe('draft A')
  expect(bodies()).toEqual(['comment A'])
  const saved = stash().entries[0]!
  expect(saved.prompt).toBe('draft B')
  expect(saved.reviewComments?.map((comment) => comment.body)).toEqual(['comment B'])

  // A draft holding only a comment is swapped out whole as well.
  drafts().setPrompt(target, '')
  resetReviewDraftStore()
  commentOn('s-c', 'comment C')
  await transferStash(target, { kind: 'restore', entry: saved })
  expect(drafts().getDraft(target).prompt).toBe('draft B')
  expect(bodies()).toEqual(['comment B'])
  expect(stash().entries[0]?.reviewComments?.map((comment) => comment.body)).toEqual(['comment C'])
})
