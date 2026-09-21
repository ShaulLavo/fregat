import { QueryClient } from '@tanstack/react-query'
import { expect, test } from '../../../../test/fixtures'
import { testScopedStorage } from '../../../../test/factories/scoped-storage'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { treeModelWithDirectoryLoads } from '@/lib/tree-model'
import { fileSystemKeys } from '@/lib/query-keys'
import {
  captureTree,
  prepareTreeReload,
  savedTree,
  TREE_RELOAD_MAX_BYTES,
} from '@/features/workspace/state/tree-reload'

test('reload preserves directory coverage and view state without admitting query data', () => {
  const owner = new QueryClient()
  const root = filesystemPath('repo')
  const entry = {
    path: filesystemPath('repo/empty'),
    name: 'empty',
    type: 'directory' as const,
    size: 0,
    mtimeMs: 1,
    birthtimeMs: 1,
    version: 'v1',
  }
  const unknown = { ...entry, path: filesystemPath('repo/unknown'), name: 'unknown' }
  const model = treeModelWithDirectoryLoads({ path: root, entries: [entry, unknown] }, root, [
    { path: entry.path, entries: [] },
  ])
  prepareTreeReload(owner, testScopedStorage)
  captureTree(owner, model, {
    root,
    worktree: null,
    activeFile: null,
    git: { observedAt: 100, entries: [{ path: 'unknown/', status: 'modified' }] },
    expanded: ['empty/'],
    selected: [],
    scrollTop: 42,
  })
  expect(savedTree(owner, root, null)?.record.scrollTop).toBe(42)
  const reloaded = new QueryClient()
  prepareTreeReload(reloaded, testScopedStorage)
  const saved = savedTree(reloaded, root, null)
  expect(saved?.model.loadedDirectoryPaths.has('empty')).toBe(true)
  expect(saved?.model.loadedDirectoryPaths.has('unknown')).toBe(false)
  expect(saved?.record.scrollTop).toBe(42)
  expect(saved?.record.expanded).toEqual(['empty/'])
  expect(saved?.record.git?.observedAt).toBe(100)
  expect(reloaded.getQueryData(fileSystemKeys.tree(root))).toBeUndefined()
  expect(savedTree(reloaded, 'other', null)).toBeNull()
  expect(savedTree(reloaded, root, 'other-checkout')).toBeNull()
  if (!saved) return
  captureTree(reloaded, saved.model, { ...saved.record, scrollTop: 64 }, saved.record.observedAt)
  const repeated = new QueryClient()
  prepareTreeReload(repeated, testScopedStorage)
  expect(savedTree(repeated, root, null)?.record.scrollTop).toBe(64)
  expect(savedTree(repeated, root, null)?.record.observedAt).toBe(saved.record.observedAt)
  expect(reloaded.getQueryData(fileSystemKeys.tree(root))).toBeUndefined()
  captureTree(owner, model, { ...saved.record, scrollTop: 86 })
  expect(savedTree(owner, root, null)?.record.scrollTop).toBe(86)
  captureTree(
    owner,
    { ...model, paths: Array.from({ length: 1501 }, (_, index) => String(index)) },
    saved.record,
  )
  expect(savedTree(owner, root, null)).toBeNull()
})

test('invalid and oversized observations cannot restore', () => {
  const owner = new QueryClient()
  for (const value of ['{', JSON.stringify({ root: 'repo' }), ' '.repeat(TREE_RELOAD_MAX_BYTES)]) {
    testScopedStorage.setItem('workspace.tree-display.v1', value)
    prepareTreeReload(owner, testScopedStorage)
    expect(savedTree(owner, 'repo', null)).toBeNull()
    expect(testScopedStorage.getItem('workspace.tree-display.v1')).toBeNull()
  }
})
