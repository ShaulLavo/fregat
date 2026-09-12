import { filesystemPath } from '@/lib/documents/utils/identity'
import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'

import {
  canPrefetchFileEntry,
  FILE_TREE_PREFETCH_MAX_BYTES,
  fileTreeFileOpenIntent,
  treeDirectoryPrefetchKey,
} from '@/features/workspace/utils/file-tree-prefetch'
import type { TreeEntry } from '@/lib/file-system-types'
import { fileSystemKeys } from '@/lib/query-keys'

describe('file tree prefetch helpers', () => {
  it('uses the same directory query key shape as expansion loads', () => {
    const entry = directory('repo/src')

    expect(treeDirectoryPrefetchKey('repo', 'src/', entry)).toEqual(
      fileSystemKeys.treeDirectory('repo', 'src', 'repo/src'),
    )
  })

  it('prefetches only file entries at or below the size cap', () => {
    expect(canPrefetchFileEntry(file('repo/small.ts', 128))).toBe(true)
    expect(canPrefetchFileEntry(file('repo/exact.ts', FILE_TREE_PREFETCH_MAX_BYTES))).toBe(true)
    expect(canPrefetchFileEntry(file('repo/large.ts', FILE_TREE_PREFETCH_MAX_BYTES + 1))).toBe(
      false,
    )
    expect(canPrefetchFileEntry(directory('repo/src'))).toBe(false)
  })

  it('creates the structured file-tree intent passed to the shared service', () => {
    expect(fileTreeFileOpenIntent('/repo', file('/repo/src/app.ts', 128))).toEqual({
      knownSize: 128,
      path: '/repo/src/app.ts',
      rootPath: '/repo',
      source: 'file-tree',
    })
  })
})

function directory(path: string): TreeEntry {
  return entry(path, 'directory', 0)
}

function file(path: string, size: number): TreeEntry {
  return entry(path, 'file', size)
}

function entry(path: string, type: TreeEntry['type'], size: number): TreeEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size,
    type,
    version: `test:1:${path}:${size}`,
  }
}
