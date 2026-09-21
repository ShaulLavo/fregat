import { act, renderHook } from '@testing-library/react'
import { useGitReloadOwner } from '@/features/git/hooks/use-reload-owner'
import { QueryClient } from '@tanstack/react-query'
import type { GitFileDiff, GitStatusResult } from '@workspace/contracts'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { environmentWindowStorage } from '@/lib/environments/state/window-storage'
import { gitKeys } from '@/lib/query-keys'
import {
  captureDiff,
  captureGitStatus,
  captureGitView,
  gitReloadGeneration,
  prepareGitReload,
  savedDiff,
  savedGit,
  GIT_RELOAD_MAX_BYTES,
} from '@/features/git/state/reload'

const status: GitStatusResult = {
  repository: { path: 'repo', branch: 'main', commit: 'abc', ahead: 0, behind: 0 },
  files: [{ path: 'repo/a.ts', index: 'unmodified', worktree: 'modified', status: 'modified' }],
}
const diff: GitFileDiff = {
  path: 'repo/a.ts',
  staged: false,
  patch: '',
  hunks: [],
  oldText: 'old',
  newText: 'new',
  oldObjectId: 'old',
  newObjectId: 'new',
}

test('Git saved display restores rows and exact diff without confirming the query cache', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  captureGitStatus(owner, 'repo', status)
  captureGitView(owner, 'repo', { activeId: 'worktree:a.ts', scrollTop: 320 })
  captureDiff(owner, gitReloadGeneration(owner), 'old:new', [diff], {
    expanded: ['gap'],
    old: { top: 100, left: 0 },
    new: { top: 100, left: 0 },
    stacked: null,
  })
  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedGit(reloaded, 'repo')?.status).toEqual(status)
  expect(savedGit(reloaded, 'repo')?.view?.scrollTop).toBe(320)
  expect(savedDiff(reloaded, 'old:new')?.view?.expanded).toEqual(['gap'])
  expect(savedDiff(reloaded, 'other')).toBeNull()
  expect(reloaded.getQueryData(gitKeys.status('repo'))).toBeUndefined()
  prepareGitReload(reloaded, storage, 'other')
  expect(savedGit(reloaded, 'repo')).toBeNull()
})

test('old root callbacks cannot attach diffs to a replacement owner', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  const generation = gitReloadGeneration(owner)
  prepareGitReload(owner, storage, 'other')
  captureDiff(owner, generation, 'old:new', [diff])
  expect(savedDiff(owner, 'old:new')).toBeNull()
})

test('malformed and oversized Git observations are dropped before parsing', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  for (const raw of ['{', '{"root":"repo"}', ' '.repeat(GIT_RELOAD_MAX_BYTES)]) {
    storage.setItem('git.display.v1', raw)
    const owner = new QueryClient()
    prepareGitReload(owner, storage, 'repo')
    expect(savedGit(owner, 'repo')?.status).toBeUndefined()
    expect(storage.getItem('git.display.v1')).toBeNull()
  }
})

test('oversized immutable diff retains presentation without pretending its data was loaded', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  captureDiff(
    owner,
    gitReloadGeneration(owner),
    'huge',
    [{ ...diff, oldText: 'x'.repeat(GIT_RELOAD_MAX_BYTES) }],
    {
      expanded: ['gap'],
      old: { top: 620, left: 0 },
      new: { top: 620, left: 0 },
      stacked: null,
      oldSelections: [
        { anchorOffset: 2, headOffset: 5, startOffset: 2, endOffset: 5, affinity: 'after' },
      ],
    },
  )
  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedDiff(reloaded, 'huge')?.diffs).toBeUndefined()
  expect(savedDiff(reloaded, 'huge')?.view?.old?.top).toBe(620)
  expect(savedDiff(reloaded, 'huge')?.view?.oldSelections?.[0]?.headOffset).toBe(5)
})

test('keyboard view changes write only tiny view records beside retained diff content', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const writes: { key: string; bytes: number }[] = []
  const measured = {
    ...storage,
    setItem(key: string, value: string) {
      writes.push({ key, bytes: value.length * 2 })
      return storage.setItem(key, value)
    },
  }
  const owner = new QueryClient()
  prepareGitReload(owner, measured, 'repo')
  captureGitStatus(owner, 'repo', status)
  captureDiff(owner, gitReloadGeneration(owner), 'large', [
    { ...diff, newText: 'x'.repeat(120_000) },
  ])
  const content = storage.getItem('git.display.v1')
  expect(content!.length).toBeGreaterThan(120_000)
  writes.length = 0
  for (let index = 0; index < 100; index++)
    captureGitView(owner, 'repo', { activeId: String(index), scrollTop: index * 24 })
  expect(writes).toHaveLength(100)
  expect(writes.every((write) => write.key === 'git.view.v1' && write.bytes < 256)).toBe(true)
  expect(storage.getItem('git.display.v1')).toBe(content)
  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedGit(reloaded, 'repo')?.view).toEqual({ activeId: '99', scrollTop: 2376 })
  expect(savedDiff(reloaded, 'large')?.diffs?.[0]?.newText?.length).toBe(120_000)
})

test('over-cap current status removes the older observation from memory and disk', () => {
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  const owner = new QueryClient()
  prepareGitReload(owner, storage, 'repo')
  captureGitStatus(owner, 'repo', status)
  captureGitStatus(owner, 'repo', {
    ...status,
    files: Array.from({ length: 1501 }, () => status.files[0]!),
  })
  expect(savedGit(owner, 'repo')?.status).toBeUndefined()
  const reloaded = new QueryClient()
  prepareGitReload(reloaded, storage, 'repo')
  expect(savedGit(reloaded, 'repo')?.status).toBeUndefined()
})

test('a mounted Git reader observes owner replacement without a query event', () => {
  const owner = new QueryClient()
  const storage = environmentWindowStorage(testScopedStorage.environmentId)
  prepareGitReload(owner, storage, 'repo')
  const { result, unmount } = renderHook(() => useGitReloadOwner(owner))
  const first = result.current
  act(() => prepareGitReload(owner, storage, 'other'))
  expect(result.current).not.toBe(first)
  expect(savedGit(owner, 'repo')).toBeNull()
  unmount()
})
