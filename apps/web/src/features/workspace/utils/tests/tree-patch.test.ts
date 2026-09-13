import { filesystemPath } from '@/lib/documents/utils/identity'
import type { TreeEntry } from '@/lib/file-system-types'
import { treeModel } from '@/lib/tree-model'
import { expect, test } from 'vitest'

import {
  applyTreePatch,
  treePatchConfirmed,
  treePatchResources,
} from '@/features/workspace/utils/tree-patch'

const root = filesystemPath('/repo')

test('create adds a synthetic entry and marks a new folder loaded', () => {
  const model = fileTreeModel([file('/repo/a.ts')])

  const withFile = applyTreePatch(model, {
    kind: 'create',
    rootPath: root,
    treePath: 'b.ts',
    isFolder: false,
  })
  expect(withFile.paths).toEqual(['a.ts', 'b.ts'])
  expect(withFile.entriesByTreePath.get('b.ts')?.path).toBe('/repo/b.ts')

  const withFolder = applyTreePatch(model, {
    kind: 'create',
    rootPath: root,
    treePath: 'src/',
    isFolder: true,
  })
  expect(withFolder.paths).toContain('src/')
  expect(withFolder.loadedDirectoryPaths.has('src')).toBe(true)
  expect(model.paths).toEqual(['a.ts'])
})

test('delete removes the entry and everything under it', () => {
  const model = fileTreeModel([directory('/repo/src'), file('/repo/src/a.ts'), file('/repo/b.ts')])
  const next = applyTreePatch(model, { kind: 'delete', rootPath: root, treePath: 'src' })
  expect(next.paths).toEqual(['b.ts'])
  expect(next.entriesByTreePath.has('src/a.ts')).toBe(false)
})

test('duplicate copies a directory with its children under the new name', () => {
  const model = fileTreeModel([directory('/repo/src'), file('/repo/src/a.ts')])
  const next = applyTreePatch(model, {
    kind: 'duplicate',
    rootPath: root,
    from: 'src',
    to: 'src copy',
    isFolder: true,
  })
  expect(next.paths).toEqual(['src/', 'src/a.ts', 'src copy/', 'src copy/a.ts'])
  expect(next.entriesByTreePath.get('src copy/a.ts')?.path).toBe('/repo/src copy/a.ts')
  expect(next.entriesByTreePath.get('src copy')?.name).toBe('src copy')
})

test('a move is confirmed once the source is gone and the destination is visible or unlisted', () => {
  const patch = {
    kind: 'move',
    rootPath: root,
    moves: [{ fromTreePath: 'a.ts', toTreePath: 'nested/a.ts' }],
  } as const
  expect(treePatchConfirmed(fileTreeModel([file('/repo/a.ts')]), patch)).toBe(false)
  expect(
    treePatchConfirmed(
      fileTreeModel([directory('/repo/nested'), file('/repo/nested/a.ts')]),
      patch,
    ),
  ).toBe(true)

  // The destination directory has not been listed, so the server cannot show the file yet.
  const unlisted = fileTreeModel([directory('/repo/nested')])
  expect(treePatchConfirmed(unlisted, patch)).toBe(true)

  const listed = fileTreeModel([directory('/repo/nested')])
  listed.loadedDirectoryPaths.add('nested')
  expect(treePatchConfirmed(listed, patch)).toBe(false)
  expect(treePatchResources(patch)).toEqual(['/repo:a.ts', '/repo:nested/a.ts'])
})

function fileTreeModel(entries: readonly TreeEntry[]) {
  return treeModel({ entries: [...entries], path: root }, '/repo')
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
