import { filesystemPath } from '@/lib/documents/utils/identity'
import { testTabContents } from '../../../../test/factories/document-targets'
import { healthDescriptorSchema, environmentIdSchema } from '@workspace/contracts'
import {
  readCachedEnvironmentBindings,
  recordEnvironmentCacheBinding,
  CHAT_PROJECTION_CACHE_STORAGE_KEY,
  chatProjectionCacheFromState,
  readChatProjectionCache,
  writeChatProjectionCache,
  hydrateChatProjectionState,
} from '@/features/chat/state/chat-projection-cache'
import {
  initializeSessionSelectionStorage,
  restoreEnvironmentSessionSelection,
  useSessionSelectionStore,
} from '@/features/chat-mode/state/session-selection-store'
import {
  readSessionSelectionCache,
  writeSessionSelectionCache,
  emptyWorkspaceSlice,
  readWorkspaceCache,
  workspaceSliceStorageKey,
  writeRootFolderCache,
  writeWorkspaceIndexCache,
  writeWorkspaceSliceCache,
} from '@/features/workspace/state/cache'
import { TEST_PROJECT_ID, TEST_SESSION_ID, TEST_WORKTREE_ID } from '../../../../test/factories/chat'
import {
  useChatChangedFilesExpansionStore,
  hydrateChatChangedFilesExpansionStoreFromStorage,
  resetChatChangedFilesExpansionStore,
} from '@/features/chat/state/chat-changed-files-expansion-store'
import { CHAT_CHANGED_FILES_EXPANSION_LIMIT } from '@/features/chat/utils/changed-files-expansion-storage'
import { beforeEach } from 'vitest'
import * as v from 'valibot'
import { expect, test } from '../../../../test/fixtures'
import { environmentScopedStorage } from '@/lib/environments/state/scoped-storage'
import { createPromptStashStore } from '@/features/chat/state/prompt-stash-store'
import {
  hydrateChatInputDraftStoreFromStorage,
  resetChatInputDraftStore,
  useChatInputDraftStore,
} from '@/features/chat/state/chat-input-draft-store'
import { readPersistedChatInputDrafts } from '@/features/chat/utils/draft-storage'
import { createInitialChatProjectionSlice } from '@workspace/client-core/chat/types'
import { createInitialChatProjectionState } from '@/features/chat/state/chat-projection-store'

const a = environmentScopedStorage(
  v.parse(environmentIdSchema, 'acb59787-a2a8-4a00-9aee-aa242be93d01'),
)
const b = environmentScopedStorage(
  v.parse(environmentIdSchema, 'acb59787-a2a8-4a00-9aee-aa242be93d02'),
)

beforeEach(() => {
  localStorage.clear()
  resetChatInputDraftStore()
})

test('matching root paths retain independent tabs and workspace indexes', () => {
  const root = {
    name: 'repo',
    path: filesystemPath('/repo'),
    type: 'directory',
    birthtimeMs: 0,
    mtimeMs: 0,
    size: 0,
    version: '',
  } as const
  writeRootFolderCache(a, root)
  writeWorkspaceSliceCache(a, '/repo', {
    ...emptyWorkspaceSlice(),
    editorHistory: testTabContents(['/repo/a.ts']),
  })
  writeWorkspaceIndexCache(a, ['/repo'])
  expect(readWorkspaceCache(b).rootFolder).toBeNull()
  writeRootFolderCache(b, root)
  writeWorkspaceSliceCache(b, '/repo', {
    ...emptyWorkspaceSlice(),
    editorHistory: testTabContents(['/repo/b.ts']),
  })
  writeWorkspaceIndexCache(b, ['/repo'])
  expect(readWorkspaceCache(a).workspaces['/repo']?.editorHistory).toEqual(
    testTabContents(['/repo/a.ts']),
  )
  expect(readWorkspaceCache(b).workspaces['/repo']?.editorHistory).toEqual(
    testTabContents(['/repo/b.ts']),
  )
  writeWorkspaceIndexCache(a, [])
  expect(b.getItem(workspaceSliceStorageKey('/repo'))).not.toBeNull()
})

test('version sweeps enumerate only the captured environment namespace', () => {
  const obsolete = 'platform.workspace-state.v19.workspace:/repo'
  a.setItem(obsolete, 'old A')
  b.setItem(obsolete, 'old B')
  localStorage.setItem(obsolete, 'unscoped')
  expect(a.keys('platform.workspace-state')).toEqual([obsolete])
  readWorkspaceCache(a)
  expect(a.getItem(obsolete)).toBeNull()
  expect(b.getItem(obsolete)).toBe('old B')
  expect(localStorage.getItem(obsolete)).toBe('unscoped')
})

test('draft writes keep identical paths and session keys on their captured machine', () => {
  hydrateChatInputDraftStoreFromStorage(a)
  hydrateChatInputDraftStoreFromStorage(b)
  const target = { draftKey: 'same-session', rootPath: '/repo' }
  useChatInputDraftStore
    .getState()
    .setPrompt({ ...target, environmentId: a.environmentId }, 'A dirty prompt')
  useChatInputDraftStore
    .getState()
    .setPrompt({ ...target, environmentId: b.environmentId }, 'B dirty prompt')
  expect(useChatInputDraftStore.getState().flush()).toBe(true)
  expect(
    Object.values(readPersistedChatInputDrafts(a).draftsByKey).map((draft) => draft.prompt),
  ).toEqual(['A dirty prompt'])
  expect(
    Object.values(readPersistedChatInputDrafts(b).draftsByKey).map((draft) => draft.prompt),
  ).toEqual(['B dirty prompt'])
})

test('prompt queues reload independently', () => {
  createPromptStashStore(a).getState().stashPrompt('A prompt')
  createPromptStashStore(b).getState().stashPrompt('B prompt')
  expect(
    createPromptStashStore(a)
      .getState()
      .entries.map((entry) => entry.prompt),
  ).toEqual(['A prompt'])
  expect(
    createPromptStashStore(b)
      .getState()
      .entries.map((entry) => entry.prompt),
  ).toEqual(['B prompt'])
})

test('each projection cache hydrates its own stale slice before sockets connect', () => {
  const state = {
    slices: {
      [a.environmentId]: createInitialChatProjectionSlice(),
      [b.environmentId]: createInitialChatProjectionSlice(),
    },
  }
  const cached = chatProjectionCacheFromState(state)
  writeChatProjectionCache(a, cached)
  writeChatProjectionCache(b, cached)
  expect(readChatProjectionCache(a)?.slices.map((slice) => slice.environmentId)).toEqual([
    a.environmentId,
  ])
  expect(readChatProjectionCache(b)?.slices.map((slice) => slice.environmentId)).toEqual([
    b.environmentId,
  ])
  const coldA = hydrateChatProjectionState(
    createInitialChatProjectionState(),
    readChatProjectionCache(a),
  )
  const coldBoth = hydrateChatProjectionState(coldA, readChatProjectionCache(b))
  expect(Object.keys(coldBoth.slices)).toHaveLength(2)
  expect(Object.values(coldBoth.slices).every((slice) => !slice.bootstrapComplete)).toBe(true)
})

test('switching into an empty machine preserves the outgoing remembered session', () => {
  initializeSessionSelectionStorage(a)
  initializeSessionSelectionStorage(b)
  const selection = {
    kind: 'session',
    environmentId: a.environmentId,
    projectId: TEST_PROJECT_ID,
    sessionId: TEST_SESSION_ID,
  } as const
  writeSessionSelectionCache(a, selection)
  restoreEnvironmentSessionSelection(a.environmentId)
  restoreEnvironmentSessionSelection(b.environmentId)
  expect(useSessionSelectionStore.getState().selection).toEqual({ kind: 'auto' })
  expect(readSessionSelectionCache(a)).toEqual(selection)
})

test('one machine cannot evict another machine disclosure choices', () => {
  resetChatChangedFilesExpansionStore()
  hydrateChatChangedFilesExpansionStoreFromStorage(a)
  hydrateChatChangedFilesExpansionStoreFromStorage(b)
  const store = useChatChangedFilesExpansionStore.getState()
  const aKey = `${a.environmentId}:same-session:turn`
  store.setCardExpanded(aKey, true)
  for (let index = 0; index <= CHAT_CHANGED_FILES_EXPANSION_LIMIT; index += 1) {
    store.setCardExpanded(`${b.environmentId}:session-${index}:turn`, false)
  }
  expect(useChatChangedFilesExpansionStore.getState().expansionByKey[aKey]?.cardExpanded).toBe(true)
})

test('cold machine discovery keeps aliases with their confirmed identity and preserves bindings across projection flushes', async ({
  client,
}) => {
  const health = v.parse(healthDescriptorSchema, (await client.health.get()).data)
  const descriptorA = { ...health, environmentId: a.environmentId }
  const descriptorB = { ...health, environmentId: b.environmentId }
  recordEnvironmentCacheBinding(a, {
    names: ['local'],
    origin: 'http://localhost:3001',
    descriptor: descriptorA,
  })
  recordEnvironmentCacheBinding(a, {
    names: ['loopback-alias'],
    origin: 'http://localhost:39001',
    descriptor: descriptorA,
  })
  recordEnvironmentCacheBinding(b, {
    names: ['remote'],
    origin: 'http://localhost:39002',
    descriptor: descriptorB,
  })
  const cached = chatProjectionCacheFromState({
    slices: {
      [a.environmentId]: createInitialChatProjectionSlice(),
      [b.environmentId]: createInitialChatProjectionSlice(),
    },
  })
  writeChatProjectionCache(a, cached)
  writeChatProjectionCache(b, cached)
  const bindings = readCachedEnvironmentBindings(['local', 'remote'])
  expect(bindings).toHaveLength(2)
  expect(
    bindings.find((binding) => binding.descriptor.environmentId === a.environmentId),
  ).toMatchObject({ names: ['local', 'loopback-alias'], origin: 'http://localhost:3001' })
  expect(readCachedEnvironmentBindings(['not-connected'])).toEqual([])
  const invalid = {
    ...readChatProjectionCache(b),
    binding: { names: ['remote'], origin: 'http://localhost:39002', descriptor: descriptorA },
  }
  b.setItem(CHAT_PROJECTION_CACHE_STORAGE_KEY, JSON.stringify(invalid))
  expect(readCachedEnvironmentBindings(['remote'])).toEqual([])
})

test('registered checkout cache keys use WorktreeId and cold root selection restores that owner', () => {
  const root = {
    name: 'repo',
    path: filesystemPath('/repo'),
    type: 'directory',
    birthtimeMs: 0,
    mtimeMs: 0,
    size: 0,
    version: '',
  } as const
  writeRootFolderCache(a, root, TEST_WORKTREE_ID)
  writeWorkspaceSliceCache(
    a,
    root.path,
    { ...emptyWorkspaceSlice(), editorHistory: testTabContents(['/repo/owned.ts']) },
    TEST_WORKTREE_ID,
  )
  writeWorkspaceIndexCache(a, [root.path], { [root.path]: TEST_WORKTREE_ID })
  expect(a.getItem(workspaceSliceStorageKey(root.path))).toBeNull()
  expect(a.keys('platform.workspace-state')).toContain(
    workspaceSliceStorageKey(root.path, TEST_WORKTREE_ID),
  )
  expect(readWorkspaceCache(a).worktreeIdByRootPath[root.path]).toBe(TEST_WORKTREE_ID)
  expect(readWorkspaceCache(a).workspaces[root.path]?.editorHistory).toEqual(
    testTabContents(['/repo/owned.ts']),
  )
  writeRootFolderCache(b, root, TEST_WORKTREE_ID)
  writeWorkspaceSliceCache(
    b,
    root.path,
    { ...emptyWorkspaceSlice(), editorHistory: testTabContents(['/repo/b.ts']) },
    TEST_WORKTREE_ID,
  )
  writeWorkspaceIndexCache(b, [root.path], { [root.path]: TEST_WORKTREE_ID })
  expect(readWorkspaceCache(b).workspaces[root.path]?.editorHistory).toEqual(
    testTabContents(['/repo/b.ts']),
  )
  expect(readWorkspaceCache(a).workspaces[root.path]?.editorHistory).toEqual(
    testTabContents(['/repo/owned.ts']),
  )
  writeWorkspaceIndexCache(a, [])
  expect(b.getItem(workspaceSliceStorageKey(root.path, TEST_WORKTREE_ID))).not.toBeNull()
})
