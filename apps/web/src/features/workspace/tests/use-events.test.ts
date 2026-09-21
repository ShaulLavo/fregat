import { describe, expect, it } from 'vitest'
import { fileSystemKeys } from '@/lib/query-keys'
import { shouldRefreshReadyRootTree } from '@/features/workspace/hooks/use-events'
import {
  affectedDirectoryPaths,
  affectedOpenFileRefreshPaths,
  mayTrustCachedSnapshot,
  planFetchedOpenFileRefresh,
  planWorkspaceFilesystemEvents,
  planWorkspaceReady,
} from '@/features/workspace/utils/event-model'
import { planWorkspaceEditAwareEventBatch } from '@/features/workspace/utils/workspace-edit-events'

describe('shouldRefreshReadyRootTree', () => {
  it('skips ready refresh when the root tree query is fetching', () => {
    const queryClient = queryClientWithState('repo', {
      data: {},
      dataUpdatedAt: 0,
      fetchStatus: 'fetching',
    })

    expect(shouldRefreshReadyRootTree(queryClient, 'repo', 20_000)).toBe(false)
  })

  it('skips ready refresh when the root tree query is fresh', () => {
    const queryClient = queryClientWithState('repo', {
      data: {},
      dataUpdatedAt: 15_000,
      fetchStatus: 'idle',
    })

    expect(shouldRefreshReadyRootTree(queryClient, 'repo', 20_000)).toBe(false)
  })

  it('refreshes ready root tree when cached data is stale', () => {
    const queryClient = queryClientWithState('repo', {
      data: {},
      dataUpdatedAt: 1_000,
      fetchStatus: 'idle',
    })

    expect(shouldRefreshReadyRootTree(queryClient, 'repo', 20_000)).toBe(true)
  })

  it('refreshes ready root tree when cached data was invalidated', () => {
    const queryClient = queryClientWithState('repo', {
      data: {},
      dataUpdatedAt: 19_000,
      fetchStatus: 'idle',
      isInvalidated: true,
    })

    expect(shouldRefreshReadyRootTree(queryClient, 'repo', 20_000)).toBe(true)
  })
})

describe('affectedOpenFileRefreshPaths', () => {
  const root = 'repo'
  const openFiles = ['repo/a.ts', 'repo/b.ts', 'repo/src/c.ts']

  it('refreshes the exact open file for changed events', () => {
    const paths = affectedOpenFileRefreshPaths(
      [{ type: 'changed', path: 'repo/a.ts' }],
      openFiles,
      new Set(),
      root,
    )

    expect(paths).toEqual(['repo/a.ts'])
  })

  it('does not refresh sibling tabs for ordinary non-open changes', () => {
    const paths = affectedOpenFileRefreshPaths(
      [{ type: 'changed', path: 'repo/package.json' }],
      openFiles,
      new Set(),
      root,
    )

    expect(paths).toEqual([])
  })

  it('uses directory fallback for temporary save paths', () => {
    const paths = affectedOpenFileRefreshPaths(
      [{ type: 'changed', path: 'repo/.a.ts.tmp' }],
      openFiles,
      new Set(),
      root,
    )

    expect(paths).toEqual(['repo/a.ts', 'repo/b.ts'])
  })
})

describe('planWorkspaceFilesystemEvents', () => {
  const rootPath = 'repo'

  it('plans tree and open-file refresh operations for changed files', () => {
    const entry = treeEntry('repo/a.ts')
    const plan = planWorkspaceFilesystemEvents({
      events: [{ entry, path: 'repo/a.ts', type: 'changed' }],
      openFiles: [{ hasLiveDocument: true, isDirty: false, path: 'repo/a.ts' }],
      rootPath,
    })

    expect(plan).toEqual({
      openFileOperations: [{ path: 'repo/a.ts', reason: 'changed', type: 'refresh-open-file' }],
      shouldInvalidateGitState: true,
      treeOperations: [{ entries: [entry], type: 'patch-changed-tree-entries' }],
    })
  })

  it('retains clean and dirty editors when files are deleted externally', () => {
    const plan = planWorkspaceFilesystemEvents({
      events: [{ path: 'repo/src', type: 'deleted' }],
      openFiles: [
        { hasLiveDocument: false, isDirty: false, path: 'repo/src/a.ts' },
        { hasLiveDocument: true, isDirty: true, path: 'repo/src/b.ts' },
      ],
      rootPath,
    })

    expect(plan.openFileOperations).toEqual([
      { path: 'repo/src/a.ts', reason: 'deleted', type: 'refresh-open-file' },
      { path: 'repo/src/b.ts', reason: 'deleted', type: 'refresh-open-file' },
    ])
  })

  it('plans a refresh instead of discard when a deleted file is recreated', () => {
    const plan = planWorkspaceFilesystemEvents({
      events: [
        { path: 'repo/a.ts', type: 'deleted' },
        { path: 'repo/a.ts', type: 'created' },
      ],
      openFiles: [{ hasLiveDocument: true, isDirty: false, path: 'repo/a.ts' }],
      rootPath,
    })

    expect(plan.openFileOperations).toEqual([
      { path: 'repo/a.ts', reason: 'changed', type: 'refresh-open-file' },
    ])
  })

  it('plans rename and conflict operations for renamed open files', () => {
    const plan = planWorkspaceFilesystemEvents({
      events: [{ oldPath: 'repo/old', path: 'repo/new', type: 'renamed' }],
      openFiles: [
        { hasLiveDocument: false, isDirty: false, path: 'repo/old/a.ts' },
        { hasLiveDocument: true, isDirty: true, path: 'repo/old/b.ts' },
      ],
      rootPath,
    })

    expect(plan.openFileOperations).toEqual([
      { from: 'repo/old/a.ts', to: 'repo/new/a.ts', type: 'rename-open-file' },
      {
        localPath: 'repo/old/b.ts',
        remotePath: 'repo/new/b.ts',
        type: 'renamed-conflict',
      },
    ])
  })

  it('does not refresh changed open files without a live document', () => {
    const plan = planWorkspaceFilesystemEvents({
      events: [{ path: 'repo/a.ts', type: 'changed' }],
      openFiles: [{ hasLiveDocument: false, isDirty: false, path: 'repo/a.ts' }],
      rootPath,
    })

    expect(plan.openFileOperations).toEqual([])
  })
})

describe('workspace transaction event reconciliation', () => {
  const openFiles = [{ hasLiveDocument: true, isDirty: true, path: 'repo/a.ts' }]
  const isOwnEvent = (writeId: string) => writeId === 'operation-1'

  it('treats matching finalized transaction events as idempotent invalidation hints', () => {
    const entry = treeEntry('repo/a.ts')
    const plan = planWorkspaceEditAwareEventBatch(
      [
        {
          entry,
          origin: 'workspace-edit',
          path: 'repo/a.ts',
          type: 'changed',
          writeId: 'operation-1',
        },
      ],
      openFiles,
      'repo',
      isOwnEvent,
    )

    expect(plan).toEqual({
      openFileOperations: [],
      shouldInvalidateGitState: true,
      treeOperations: [{ entries: [entry], type: 'patch-changed-tree-entries' }],
    })
  })

  it('does not conflict or remap a dirty buffer on its own delete and rename replay', () => {
    const plan = planWorkspaceEditAwareEventBatch(
      [
        {
          oldPath: 'repo/a.ts',
          origin: 'workspace-edit',
          path: 'repo/b.ts',
          type: 'renamed',
          writeId: 'operation-1',
        },
        {
          origin: 'workspace-edit',
          path: 'repo/a.ts',
          type: 'deleted',
          writeId: 'operation-1',
        },
      ],
      openFiles,
      'repo',
      isOwnEvent,
    )

    expect(plan.openFileOperations).toEqual([])
    expect(plan.treeOperations).toEqual([{ path: 'repo', type: 'refresh-tree-directory' }])
  })

  it('treats the editor save echo as own regardless of origin', () => {
    const plan = planWorkspaceEditAwareEventBatch(
      [{ origin: 'editor', path: 'repo/a.ts', type: 'changed', writeId: 'operation-1' }],
      openFiles,
      'repo',
      isOwnEvent,
    )

    expect(plan.openFileOperations).toEqual([])
    expect(plan.shouldInvalidateGitState).toBe(true)
  })

  it('carries the reported disk version into an external change refresh', () => {
    const plan = planWorkspaceEditAwareEventBatch(
      [{ path: 'repo/a.ts', type: 'changed', version: 'sha256:v2', writeId: 'other' }],
      openFiles,
      'repo',
      isOwnEvent,
    )

    expect(plan.openFileOperations).toEqual([
      { path: 'repo/a.ts', reason: 'changed', type: 'refresh-open-file', version: 'sha256:v2' },
    ])
  })

  it('reconciles a later genuine external event by identity rather than timing', () => {
    const plan = planWorkspaceEditAwareEventBatch(
      [
        {
          origin: 'workspace-edit',
          path: 'repo/a.ts',
          type: 'changed',
          writeId: 'other-operation',
        },
      ],
      openFiles,
      'repo',
      isOwnEvent,
    )

    expect(plan.openFileOperations).toEqual([
      { path: 'repo/a.ts', reason: 'changed', type: 'refresh-open-file' },
    ])
  })
})

describe('mayTrustCachedSnapshot', () => {
  it('rereads disk after watch registration even when the snapshot is fresh', () => {
    expect(
      mayTrustCachedSnapshot({ path: 'a', reason: 'ready', type: 'refresh-open-file' }, 'v1'),
    ).toBe(false)
  })

  it('reads disk for a change whose version the snapshot does not hold', () => {
    const refresh = {
      path: 'a',
      reason: 'changed',
      type: 'refresh-open-file',
      version: 'v2',
    } as const
    expect(mayTrustCachedSnapshot(refresh, 'v1')).toBe(false)
    expect(mayTrustCachedSnapshot(refresh, undefined)).toBe(false)
    expect(mayTrustCachedSnapshot(refresh, 'v2')).toBe(true)
  })

  it('reads disk for a change with no reported version', () => {
    expect(
      mayTrustCachedSnapshot({ path: 'a', reason: 'changed', type: 'refresh-open-file' }, 'v1'),
    ).toBe(false)
  })
})

describe('planWorkspaceReady', () => {
  it('refreshes only clean open files with live documents', () => {
    const plan = planWorkspaceReady({
      openFiles: [
        { hasLiveDocument: true, isDirty: false, path: 'repo/a.ts' },
        { hasLiveDocument: true, isDirty: true, path: 'repo/b.ts' },
        { hasLiveDocument: false, isDirty: false, path: 'repo/c.ts' },
      ],
      rootPath: 'repo',
    })

    expect(plan).toEqual({
      openFileOperations: [{ path: 'repo/a.ts', reason: 'ready', type: 'refresh-open-file' }],
      shouldInvalidateGitState: true,
      treeOperations: [{ path: 'repo', type: 'refresh-ready-root-tree' }],
    })
  })
})

describe('planFetchedOpenFileRefresh', () => {
  it('replaces matching text without dirty-overwrite notification', () => {
    const operation = planFetchedOpenFileRefresh({
      liveText: 'same',
      isDirty: true,
      path: 'repo/a.ts',
      remoteText: 'same',
    })

    expect(operation).toEqual({
      notifyDirtyOverwrite: false,
      path: 'repo/a.ts',
      type: 'replace-open-file',
    })
  })

  it('plans a conflict for dirty documents with different remote text', () => {
    const operation = planFetchedOpenFileRefresh({
      liveText: 'local',
      isDirty: true,
      path: 'repo/a.ts',
      remoteText: 'remote',
    })

    expect(operation).toEqual({
      path: 'repo/a.ts',
      type: 'changed-conflict',
    })
  })

  it('replaces clean documents with dirty-overwrite notification enabled', () => {
    const operation = planFetchedOpenFileRefresh({
      liveText: 'local',
      isDirty: false,
      path: 'repo/a.ts',
      remoteText: 'remote',
    })

    expect(operation).toEqual({
      notifyDirtyOverwrite: true,
      path: 'repo/a.ts',
      type: 'replace-open-file',
    })
  })
})

describe('affectedDirectoryPaths', () => {
  it('does not refresh tree directories for temporary save files', () => {
    const paths = affectedDirectoryPaths(
      [
        { type: 'created', path: 'repo/.a.ts.ulid.tmp' },
        { type: 'deleted', path: 'repo/.a.ts.ulid.tmp' },
      ],
      'repo',
    )

    expect(Array.from(paths)).toEqual([])
  })

  it('refreshes tree directories for real created files', () => {
    const paths = affectedDirectoryPaths([{ type: 'created', path: 'repo/src/new.ts' }], 'repo')

    expect(Array.from(paths)).toEqual(['repo/src'])
  })
})

function queryClientWithState(
  rootPath: string,
  state: {
    data?: unknown
    dataUpdatedAt: number
    fetchStatus: string
    isInvalidated?: boolean
  },
) {
  return {
    getQueryState: (queryKey: readonly unknown[]) => {
      if (JSON.stringify(queryKey) !== JSON.stringify(fileSystemKeys.tree(rootPath))) {
        return undefined
      }

      return state
    },
  }
}

function treeEntry(path: string) {
  return {
    birthtimeMs: 1,
    mtimeMs: 2,
    name: path.split('/').at(-1) ?? path,
    path,
    size: 3,
    type: 'file' as const,
    version: `test:2:${path}`,
  }
}

describe('conflict resolution event reconciliation', () => {
  const openFiles = [{ hasLiveDocument: true, isDirty: true, path: 'repo/a.ts' }]
  const isOwnEvent = (writeId: string) => writeId === 'resolution-1'

  it.each(['created', 'changed'] as const)(
    'keeps tree and Git effects for its own %s event',
    (type) => {
      const event = {
        entry: treeEntry('repo/a.ts'),
        type,
        path: 'repo/a.ts',
        origin: 'conflict-editor-resolution',
        writeId: 'resolution-1',
      }
      const plan = planWorkspaceEditAwareEventBatch([event], openFiles, 'repo', isOwnEvent)
      expect(plan.openFileOperations).toEqual([])
      expect(plan.treeOperations.length).toBeGreaterThan(0)
      expect(plan.shouldInvalidateGitState).toBe(true)
    },
  )

  it.each([undefined, 'another-resolution'])('keeps external writes with ID %s', (writeId) => {
    const plan = planWorkspaceEditAwareEventBatch(
      [{ type: 'changed', path: 'repo/a.ts', origin: 'conflict-editor-resolution', writeId }],
      openFiles,
      'repo',
      isOwnEvent,
    )
    expect(plan.openFileOperations).toEqual([
      { path: 'repo/a.ts', reason: 'changed', type: 'refresh-open-file' },
    ])
  })

  it('preserves an external change batched with an owned resolution event', () => {
    const plan = planWorkspaceEditAwareEventBatch(
      [
        {
          type: 'changed',
          path: 'repo/a.ts',
          origin: 'conflict-editor-resolution',
          writeId: 'resolution-1',
        },
        { type: 'deleted', path: 'repo/a.ts' },
      ],
      openFiles,
      'repo',
      isOwnEvent,
    )
    expect(plan.openFileOperations).toEqual([
      { type: 'refresh-open-file', reason: 'deleted', path: 'repo/a.ts' },
    ])
  })
})
