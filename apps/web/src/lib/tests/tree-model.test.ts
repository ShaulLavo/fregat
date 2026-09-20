import { filesystemPath } from '@/lib/documents/utils/identity'
import { describe } from 'vitest'
import { expect, test as it } from '../../../test/fixtures'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import {
  moveTreeModelPaths,
  patchTreeEntryMetadata,
  replaceDirectoryLoad,
  shouldLoadDirectory,
  treeModel,
  treeModelWithDirectoryLoads,
} from '@/lib/tree-model'

describe('treeModelWithDirectoryLoads', () => {
  it('treats symlink directory targets as loadable directory paths', () => {
    const model = treeModel(tree('repo', [symlinkDirectory('repo/packages')]), 'repo')

    expect(model.paths).toEqual(['packages/'])
  })

  it('merges selected-file ancestor directory loads into the initial model', () => {
    const root = 'repo'
    const model = treeModelWithDirectoryLoads(
      tree(root, [directory('repo/src'), file('repo/README.md')]),
      root,
      [
        tree('repo/src', [directory('repo/src/components'), file('repo/src/index.ts')]),
        tree('repo/src/components', [file('repo/src/components/Button.tsx')]),
      ],
    )

    expect(model.paths).toEqual([
      'src/',
      'README.md',
      'src/components/',
      'src/index.ts',
      'src/components/Button.tsx',
    ])
    expect(model.loadedDirectoryPaths).toEqual(new Set(['src', 'src/components']))
    expect(model.entriesByTreePath.get('src/components/Button.tsx')).toEqual(
      file('repo/src/components/Button.tsx'),
    )
  })
})

describe('replaceDirectoryLoad', () => {
  it.each(['repo', 'repo/src'])(
    'preserves loaded descendants when refreshing %s',
    (refreshedPath) => {
      const model = treeModelWithDirectoryLoads(tree('repo', [directory('repo/src')]), 'repo', [
        tree('repo/src', [directory('repo/src/nested'), file('repo/src/sibling.txt')]),
        tree('repo/src/nested', [file('repo/src/nested/a.txt')]),
      ])
      model.loadingDirectoryPaths.add('src/nested/pending')
      model.errorByDirectoryPath.set('src/nested/failed', 'Unavailable')
      const entries =
        refreshedPath === 'repo'
          ? [directory('repo/src'), file('repo/new.txt')]
          : [directory('repo/src/nested'), file('repo/src/new.txt')]
      const next = replaceDirectoryLoad(model, 'repo', tree(refreshedPath, entries))

      expect(next.entriesByTreePath.get('src/nested/a.txt')).toEqual(file('repo/src/nested/a.txt'))
      expect(next.loadedDirectoryPaths).toEqual(new Set(['src', 'src/nested']))
      expect(next.loadingDirectoryPaths.has('src/nested/pending')).toBe(true)
      expect(next.errorByDirectoryPath.get('src/nested/failed')).toBe('Unavailable')
      expect(model.entriesByTreePath.has('new.txt')).toBe(false)
    },
  )

  it('refreshes explicit child listings while preserving unlisted grandchildren', () => {
    const model = treeModelWithDirectoryLoads(tree('repo', [directory('repo/src')]), 'repo', [
      tree('repo/src', [directory('repo/src/nested'), file('repo/src/old.txt')]),
      tree('repo/src/nested', [file('repo/src/nested/a.txt')]),
    ])
    const next = replaceDirectoryLoad(
      model,
      'repo',
      tree('repo', [
        directory('repo/src', [directory('repo/src/nested'), file('repo/src/new.txt')]),
      ]),
    )

    expect(next.entriesByTreePath.has('src/old.txt')).toBe(false)
    expect(next.entriesByTreePath.has('src/new.txt')).toBe(true)
    expect(next.entriesByTreePath.has('src/nested/a.txt')).toBe(true)
    expect(next.loadedDirectoryPaths).toEqual(new Set(['src', 'src/nested']))
  })

  it('removes descendant entries and load state when a directory becomes a file', () => {
    const model = treeModelWithDirectoryLoads(tree('repo', [directory('repo/src')]), 'repo', [
      tree('repo/src', [directory('repo/src/nested')]),
      tree('repo/src/nested', [file('repo/src/nested/a.txt')]),
    ])
    model.loadingDirectoryPaths.add('src/pending')
    model.errorByDirectoryPath.set('src/failed', 'Unavailable')
    const next = replaceDirectoryLoad(model, 'repo', tree('repo', [file('repo/src')]))

    expect(next.paths).toEqual(['src'])
    expect(next.loadedDirectoryPaths.size).toBe(0)
    expect(next.loadingDirectoryPaths.size).toBe(0)
    expect(next.errorByDirectoryPath.size).toBe(0)
  })

  it('replaces root children and removes stale entries', () => {
    const model = treeModel(tree('', [directory('src'), file('src/old.ts'), file('README.md')]), '')
    const next = replaceDirectoryLoad(model, '', tree('', [file('package.json')]))

    expect(next.paths).toEqual(['package.json'])
    expect(next.entriesByTreePath.has('src')).toBe(false)
    expect(next.entriesByTreePath.has('src/old.ts')).toBe(false)
  })

  it('replaces a loaded directory without removing siblings', () => {
    const root = 'repo'
    const model = treeModel(
      tree(root, [directory('repo/src', [file('repo/src/old.ts')]), file('repo/README.md')]),
      root,
    )
    const next = replaceDirectoryLoad(model, root, tree('repo/src', [file('repo/src/new.ts')]))

    expect(next.paths).toEqual(['src/', 'README.md', 'src/new.ts'])
    expect(next.entriesByTreePath.has('src/old.ts')).toBe(false)
    expect(next.entriesByTreePath.has('README.md')).toBe(true)
  })
})

describe('shouldLoadDirectory', () => {
  it('does not load loaded, loading, or errored directories by default', () => {
    const loaded = treeModel(tree('repo', [directory('repo/src')]), 'repo')
    loaded.loadedDirectoryPaths.add('src')

    const loading = treeModel(tree('repo', [directory('repo/src')]), 'repo')
    loading.loadingDirectoryPaths.add('src')

    const errored = treeModel(tree('repo', [directory('repo/src')]), 'repo')
    errored.errorByDirectoryPath.set('src', 'Could not load')

    expect(shouldLoadDirectory(loaded, 'src/')).toBe(false)
    expect(shouldLoadDirectory(loading, 'src/')).toBe(false)
    expect(shouldLoadDirectory(errored, 'src/')).toBe(false)
  })

  it('allows an errored directory to load for an explicit retry', () => {
    const model = treeModel(tree('repo', [directory('repo/src')]), 'repo')
    model.errorByDirectoryPath.set('src', 'Could not load')

    expect(shouldLoadDirectory(model, 'src/', { retry: true })).toBe(true)
  })
})

describe('patchTreeEntryMetadata', () => {
  it('updates an existing entry without removing siblings', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [file('repo/a.ts'), file('repo/b.ts')]), root)
    const next = patchTreeEntryMetadata(model, root, {
      ...file('repo/a.ts'),
      mtimeMs: 25,
      size: 10,
    })

    expect(next.entriesByTreePath.get('a.ts')).toMatchObject({
      mtimeMs: 25,
      size: 10,
    })
    expect(next.entriesByTreePath.has('b.ts')).toBe(true)
    expect(next.paths).toEqual(['a.ts', 'b.ts'])
  })

  it('returns the current model when the entry is not visible', () => {
    const model = treeModel(tree('repo', [file('repo/a.ts')]), 'repo')
    const next = patchTreeEntryMetadata(model, 'repo', file('repo/missing.ts'))

    expect(next).toBe(model)
  })
})

describe('moveTreeModelPaths', () => {
  it('moves a loaded file entry and preserves sibling entries', () => {
    const root = 'repo'
    const model = treeModel(
      tree(root, [directory('repo/src'), directory('repo/tests'), file('repo/src/button.ts')]),
      root,
    )
    const next = moveTreeModelPaths(model, root, [
      { fromTreePath: 'src/button.ts', toTreePath: 'tests/button.ts' },
    ])

    expect(next.paths).toEqual(['src/', 'tests/', 'tests/button.ts'])
    expect(next.entriesByTreePath.has('src/button.ts')).toBe(false)
    expect(next.entriesByTreePath.get('tests/button.ts')).toEqual({
      ...file('repo/tests/button.ts'),
      version: 'test:1:repo/src/button.ts',
    })
    expect(next.entriesByTreePath.has('src')).toBe(true)
  })

  it('moves loaded directory descendants and directory load state', () => {
    const root = 'repo'
    const model = treeModel(
      tree(root, [
        directory('repo/src', [
          directory('repo/src/components', [file('repo/src/components/Button.tsx')]),
        ]),
        directory('repo/packages'),
      ]),
      root,
    )

    model.loadedDirectoryPaths.add('src')
    model.loadedDirectoryPaths.add('src/components')
    model.loadingDirectoryPaths.add('src/components/pending')
    model.errorByDirectoryPath.set('src/components/broken', 'Could not load')

    const next = moveTreeModelPaths(model, root, [
      { fromTreePath: 'src/components', toTreePath: 'packages/components' },
    ])

    expect(next.paths).toEqual([
      'src/',
      'packages/components/',
      'packages/components/Button.tsx',
      'packages/',
    ])
    expect(next.entriesByTreePath.has('src/components')).toBe(false)
    expect(next.entriesByTreePath.has('src/components/Button.tsx')).toBe(false)
    expect(next.entriesByTreePath.get('packages/components')).toMatchObject({
      path: 'repo/packages/components',
      type: 'directory',
    })
    expect(next.entriesByTreePath.get('packages/components/Button.tsx')).toMatchObject({
      path: 'repo/packages/components/Button.tsx',
      type: 'file',
    })
    expect(next.loadedDirectoryPaths).toEqual(new Set(['src', 'packages/components']))
    expect(next.loadingDirectoryPaths).toEqual(new Set(['packages/components/pending']))
    expect(next.errorByDirectoryPath).toEqual(
      new Map([['packages/components/broken', 'Could not load']]),
    )
  })

  it('ignores no-op and unknown moves', () => {
    const model = treeModel(tree('repo', [file('repo/a.ts')]), 'repo')

    expect(
      moveTreeModelPaths(model, 'repo', [
        { fromTreePath: 'a.ts', toTreePath: 'a.ts' },
        { fromTreePath: 'missing.ts', toTreePath: 'b.ts' },
      ]),
    ).toBe(model)
  })
})

function tree(path: string, entries: TreeEntry[]): TreeResult {
  return { entries, path: filesystemPath(path) }
}

function directory(path: string, children?: TreeEntry[]): TreeEntry {
  return entry(path, 'directory', children)
}

function file(path: string): TreeEntry {
  return entry(path, 'file')
}

function symlinkDirectory(path: string): TreeEntry {
  return {
    ...entry(path, 'symlink'),
    targetType: 'directory',
  }
}

function entry(path: string, type: TreeEntry['type'], children?: TreeEntry[]): TreeEntry {
  return {
    birthtimeMs: 1,
    children,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    type,
    version: `test:1:${path}`,
  }
}
