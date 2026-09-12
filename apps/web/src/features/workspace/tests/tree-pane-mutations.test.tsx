import { filesystemPath } from '@/lib/documents/utils/identity'
import { vi } from 'vitest'

import {
  runTreeDropMoveMutation,
  type TreeDropMoveMutationOptions,
  type TreeDropMoveRequest,
} from '@/features/workspace/components/tree-pane'
import type { TreeEntry } from '@/lib/file-system-types'
import { treeModel } from '@/lib/tree-model'

import { expect, test } from '../../../../test/fixtures'

test('projects a file move only after reservation and reports its exact paths', async () => {
  const events: string[] = []
  const reported: Array<readonly string[] | 'all'> = []
  let declared: readonly string[] | 'all' | null = null
  const request = moveRequest([{ fromTreePath: 'a.ts', toTreePath: 'nested/a.ts' }])

  await runTreeDropMoveMutation(request, {
    model: fileTreeModel([file('/repo/a.ts')]),
    project: () => events.push('project'),
    rename: async (from, to) => {
      events.push(`rename:${from}->${to}`)
    },
    runWorkspaceMutation: async (affectedPaths, operation) => {
      declared = affectedPaths
      events.push('reserved')
      expect(events).toEqual(['reserved'])
      await operation((paths) => reported.push(paths))
    },
  })

  expect(declared).toEqual(['/repo/a.ts', '/repo/nested/a.ts'])
  expect(events).toEqual(['reserved', 'project', 'rename:/repo/a.ts->/repo/nested/a.ts'])
  expect(reported).toEqual([['/repo/a.ts', '/repo/nested/a.ts']])
})

test('does not project when the authoritative reservation refuses the move', async () => {
  const project = vi.fn()
  const rename = vi.fn(async () => undefined)

  await expect(
    runTreeDropMoveMutation(moveRequest([{ fromTreePath: 'a.ts', toTreePath: 'b.ts' }]), {
      model: fileTreeModel([file('/repo/a.ts')]),
      project,
      rename,
      runWorkspaceMutation: async () => {
        throw new TypeError('busy')
      },
    }),
  ).rejects.toThrow('busy')

  expect(project).not.toHaveBeenCalled()
  expect(rename).not.toHaveBeenCalled()
})

test('uses all-path invalidation when any dragged source is a directory', async () => {
  let declared: readonly string[] | 'all' | null = null
  const reported: Array<readonly string[] | 'all'> = []
  const request = moveRequest([
    { fromTreePath: 'a.ts', toTreePath: 'nested/a.ts' },
    { fromTreePath: 'folder', toTreePath: 'nested/folder' },
  ])

  await runTreeDropMoveMutation(request, {
    model: fileTreeModel([file('/repo/a.ts'), directory('/repo/folder')]),
    project: () => undefined,
    rename: async () => undefined,
    runWorkspaceMutation: async (affectedPaths, operation) => {
      declared = affectedPaths
      await operation((paths) => reported.push(paths))
    },
  })

  expect(declared).toBe('all')
  expect(reported).toEqual([
    ['/repo/a.ts', '/repo/nested/a.ts'],
    ['/repo/folder', '/repo/nested/folder'],
    'all',
  ])
})

test('reports only completed renames when a later move fails', async () => {
  const reported: Array<readonly string[] | 'all'> = []
  const rename = vi
    .fn<TreeDropMoveMutationOptions['rename']>()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new TypeError('second rename failed'))
  const request = moveRequest([
    { fromTreePath: 'a.ts', toTreePath: 'nested/a.ts' },
    { fromTreePath: 'b.ts', toTreePath: 'nested/b.ts' },
  ])

  await expect(
    runTreeDropMoveMutation(request, {
      model: fileTreeModel([file('/repo/a.ts'), file('/repo/b.ts')]),
      project: () => undefined,
      rename,
      runWorkspaceMutation: async (_affectedPaths, operation) =>
        operation((paths) => reported.push(paths)),
    }),
  ).rejects.toThrow('second rename failed')

  expect(reported).toEqual([['/repo/a.ts', '/repo/nested/a.ts']])
})

function moveRequest(moves: TreeDropMoveRequest['moves']): TreeDropMoveRequest {
  return { moves, rootPath: filesystemPath('/repo') }
}

function fileTreeModel(entries: readonly TreeEntry[]) {
  return treeModel({ entries: [...entries], path: filesystemPath('/repo') }, '/repo')
}

function file(path: string): TreeEntry {
  return entry(path, 'file')
}

function directory(path: string): TreeEntry {
  return entry(path, 'directory')
}

function entry(path: string, type: TreeEntry['type']): TreeEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    type,
    version: `v:${path}`,
  }
}
