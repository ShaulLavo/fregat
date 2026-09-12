import { afterEach, beforeEach, vi } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'
import { memoryLocalStorage } from '../../../../../test/factories/local-storage'
import { testScopedStorage } from '../../../../../test/factories/scoped-storage'
import {
  CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY,
  readPersistedChatChangedFilesExpansion,
  writePersistedChatChangedFilesExpansion,
  nextChatChangedFilesExpansionStamp,
} from '@/features/chat/utils/changed-files-expansion-storage'
import {
  SESSION_DIFF_SCOPE_STORAGE_KEY,
  readPersistedSessionDiffScopes,
  writePersistedSessionDiffScopes,
  nextSessionDiffScopeStamp,
} from '@/features/chat/utils/session-diff-scope-storage'
import { readPersistedChatInputDrafts } from '@/features/chat/utils/draft-storage'
import {
  readPersistedSessionReads,
  writePersistedSessionReads,
} from '@/features/chat-mode/utils/session-read-storage'
import { readPersistedRailCollapse } from '@/features/chat-mode/utils/rail-collapse-storage'
import { createPromptStashStore } from '@/features/chat/state/prompt-stash-store'
import { createEnvironmentRecordPersistence } from '@/lib/environments/state/record-persistence'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { environmentIdSchema } from '@workspace/contracts'
import * as v from 'valibot'

beforeEach(() => vi.stubGlobal('localStorage', memoryLocalStorage()))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

test.each([
  ['platform.chat-input-drafts.v1', readPersistedChatInputDrafts],
  [CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY, readPersistedChatChangedFilesExpansion],
  [SESSION_DIFF_SCOPE_STORAGE_KEY, readPersistedSessionDiffScopes],
  ['platform.chat-session-reads.v1', readPersistedSessionReads],
  ['platform.chat-rail-collapse.v1', readPersistedRailCollapse],
  ['platform.prompt-stash.v1', createPromptStashStore],
] as const)('discards malformed JSON and invalid schema for %s', (key, read) => {
  testScopedStorage.setItem('unrelated', 'kept')
  for (const invalid of ['broken JSON', '{"version":999}']) {
    testScopedStorage.setItem(key, invalid)
    read(testScopedStorage)
    expect(testScopedStorage.getItem(key)).toBeNull()
  }
  expect(testScopedStorage.getItem('unrelated')).toBe('kept')
})

test('the scoped record instances retain their distinct version and persisted record names', () => {
  const expansionByKey = {
    entry: { cardExpanded: null, directoriesExpanded: true, updatedAt: 7 },
  }
  const scopeBySessionKey = {
    entry: { scope: { kind: 'working-tree' as const }, updatedAt: 9 },
  }
  writePersistedChatChangedFilesExpansion(testScopedStorage, expansionByKey)
  writePersistedSessionDiffScopes(testScopedStorage, scopeBySessionKey)

  expect(
    JSON.parse(testScopedStorage.getItem(CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY) ?? ''),
  ).toEqual({
    expansionByKey,
    version: 1,
  })
  expect(JSON.parse(testScopedStorage.getItem(SESSION_DIFF_SCOPE_STORAGE_KEY) ?? '')).toEqual({
    scopeBySessionKey,
    version: 2,
  })
  expect(readPersistedChatChangedFilesExpansion(testScopedStorage)).toEqual({
    expansionByKey,
    version: 1,
  })
  expect(readPersistedSessionDiffScopes(testScopedStorage)).toEqual({
    scopeBySessionKey,
    version: 2,
  })
})

test('scoped records prune by numeric recency on read while preserving the written record', () => {
  const entries = Object.fromEntries(
    Array.from({ length: 201 }, (_, index) => [
      `entry-${index}`,
      { cardExpanded: true, directoriesExpanded: null, updatedAt: index },
    ]),
  )
  writePersistedChatChangedFilesExpansion(testScopedStorage, entries)
  const stored = testScopedStorage.getItem(CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY)
  const read = readPersistedChatChangedFilesExpansion(testScopedStorage)

  expect(Object.keys(read.expansionByKey)).toHaveLength(200)
  expect(read.expansionByKey['entry-0']).toBeUndefined()
  expect(read.expansionByKey['entry-200']).toEqual(entries['entry-200'])
  expect(testScopedStorage.getItem(CHAT_CHANGED_FILES_EXPANSION_STORAGE_KEY)).toBe(stored)
})

test('both record clocks advance beyond existing future stamps', () => {
  const updatedAt = Date.now() + 60_000
  expect(
    nextChatChangedFilesExpansionStamp({
      entry: { cardExpanded: true, directoriesExpanded: null, updatedAt },
    }),
  ).toBe(updatedAt + 1)
  expect(
    nextSessionDiffScopeStamp({
      entry: { scope: { kind: 'working-tree' }, updatedAt },
    }),
  ).toBe(updatedAt + 1)
})

test('session reads prune on write using descending ISO timestamps', () => {
  const stamps = Object.fromEntries(
    Array.from({ length: 301 }, (_, index) => [
      `session-${index}`,
      new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    ]),
  )
  writePersistedSessionReads(testScopedStorage, stamps)

  const stored = readPersistedSessionReads(testScopedStorage)
  expect(Object.keys(stored)).toHaveLength(300)
  expect(stored['session-0']).toBeUndefined()
  expect(stored['session-300']).toBe(stamps['session-300'])
})

test('a failed environment write still saves the next environment and reports failure', () => {
  const other = environmentScopedStorage(
    v.parse(environmentIdSchema, 'acb59787-a2a8-4a00-9aee-aa242be93d02'),
  )
  const persistence = createEnvironmentRecordPersistence({
    read: readPersistedSessionReads,
    write: writePersistedSessionReads,
  })
  persistence.hydrate(testScopedStorage)
  persistence.hydrate(other)
  vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Storage quota exceeded', 'QuotaExceededError')
  })
  const seenAt = '2026-09-12T10:00:00.000Z'

  expect(
    persistence.persist({
      [`${testScopedStorage.environmentId}:session`]: seenAt,
      [`${other.environmentId}:session`]: seenAt,
    }),
  ).toBe(false)
  expect(readPersistedSessionReads(testScopedStorage)).toEqual({})
  expect(readPersistedSessionReads(other)).toEqual({ [`${other.environmentId}:session`]: seenAt })
})
