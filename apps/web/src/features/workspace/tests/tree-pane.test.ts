import { filesystemPath } from '@/lib/documents/utils/identity'
import { describe } from 'vitest'
import { expect, test as it } from '../../../../test/fixtures'
import type {
  FileTreeDirectoryHandle,
  FileTreeFileHandle,
  FileTreeItemHandle,
  FileTreeMutationEvent,
  FileTreeRowDecorationContext,
} from '@workspace/tree'
import { FileTreeModel } from '@workspace/tree'

import {
  loadExpandedDirectories,
  syncTreePaneState,
  visibleTreeItemCount,
} from '@/features/workspace/utils/tree-pane-state'
import { selectedFileEntryForTreeSelection } from '@/features/workspace/utils/tree-selection'
import { preparedTreeInputForPaths } from '@/features/workspace/state/prepared-tree-input-cache'
import { treeMutationLogContext } from '@/features/workspace/utils/tree-mutation-log'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import { cloneTreeModel, mergeDirectoryLoad, treeModel } from '@/lib/tree-model'
import { treeDecorationKey, treeRowDecoration } from '@/features/workspace/utils/tree-decoration'

describe('syncTreePaneState', () => {
  it('continues expanding newly loaded ancestors for the selected file', () => {
    const root = 'repo'
    const selectedFilePath = 'repo/src/components/Button.tsx'
    const initialModel = treeModel(tree(root, [directory('repo/src')]), root)
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: initialModel.paths,
    })
    const loadPasses: string[][] = []

    try {
      const previousPaths = syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: (currentTree) => {
          loadPasses.push(expandedDirectories(currentTree))
        },
        model: initialModel,
        previousPaths: initialModel.paths,
        rootPath: root,
        selectedFilePath,
        tree: fileTree,
      })
      const loadedModel = mergeDirectoryLoad(
        initialModel,
        root,
        tree('repo/src', [directory('repo/src/components')]),
        'src',
      )

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: (currentTree) => {
          loadPasses.push(expandedDirectories(currentTree))
        },
        model: loadedModel,
        previousPaths,
        rootPath: root,
        selectedFilePath,
        tree: fileTree,
      })

      expect(loadPasses).toEqual([['src/'], ['src/', 'src/components/']])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('loads expanded symlink directory targets', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [symlinkDirectory('repo/vendor')]), root)
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    try {
      getDirectory(fileTree, 'vendor/').expand()

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: (currentTree) => {
          loadExpandedDirectories(currentTree, model, (_entry, path) => loadedPaths.push(path))
        },
        model,
        previousPaths: model.paths,
        rootPath: root,
        selectedFilePath: null,
        tree: fileTree,
      })

      expect(loadedPaths).toEqual(['vendor/'])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('does not rewrite tree selection when the selected file is already selected', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [file('repo/src/a.ts'), file('repo/src/b.ts')]), root)
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })

    try {
      getFile(fileTree, 'src/a.ts').select()
      getFile(fileTree, 'src/b.ts').select()

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model,
        previousPaths: model.paths,
        rootPath: root,
        selectedFilePath: 'repo/src/b.ts',
        tree: fileTree,
      })

      expect(fileTree.getSelectedPaths()).toEqual(['src/a.ts', 'src/b.ts'])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('does not reselect the active editor file during tree-only syncs', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src'), file('repo/src/a.ts')]), root)
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })

    try {
      getDirectory(fileTree, 'src/').select()

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model,
        previousPaths: model.paths,
        rootPath: root,
        selectedFilePath: 'repo/src/a.ts',
        syncSelection: false,
        tree: fileTree,
      })

      expect(fileTree.getSelectedPaths()).toEqual(['src/'])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('skips stale removals that are already absent from the tree model', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/packages/editor-find')]), root)
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })

    try {
      expect(() => {
        syncTreePaneState({
          loadExpandedDirectoriesForCurrentModel: () => {},
          model,
          previousPaths: [...model.paths, 'packages/editor-find/.turbo/'],
          rootPath: root,
          selectedFilePath: null,
          tree: fileTree,
        })
      }).not.toThrow()
    } finally {
      fileTree.cleanUp()
    }
  })

  it('skips stale additions that already exist in the tree model', () => {
    const root = 'repo'
    const model = treeModel(
      tree(root, [
        directory('repo/packages/editor-find'),
        directory('repo/packages/editor-find/.turbo'),
      ]),
      root,
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })

    try {
      expect(() => {
        syncTreePaneState({
          loadExpandedDirectoriesForCurrentModel: () => {},
          model,
          previousPaths: model.paths.filter((path) => path !== 'packages/editor-find/.turbo/'),
          rootPath: root,
          selectedFilePath: null,
          tree: fileTree,
        })
      }).not.toThrow()
    } finally {
      fileTree.cleanUp()
    }
  })

  it('keeps focus inside a nested lazy directory after flattened children load', () => {
    const root = 'repo'
    const initialModel = mergeDirectoryLoad(
      treeModel(tree(root, [directory('repo/src')]), root),
      root,
      tree('repo/src', [directory('repo/src/components'), file('repo/src/index.ts')]),
      'src',
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: initialModel.paths,
    })

    try {
      getDirectory(fileTree, 'src/').expand()
      fileTree.focusPath('src/components/')
      getDirectory(fileTree, 'src/components/').expand()

      const loadedModel = mergeDirectoryLoad(
        initialModel,
        root,
        tree('repo/src/components', [directory('repo/src/components/ui')]),
        'src/components',
      )

      const focusChanges = focusChangesDuring(fileTree, () =>
        syncTreePaneState({
          loadExpandedDirectoriesForCurrentModel: () => {},
          model: loadedModel,
          previousPaths: initialModel.paths,
          rootPath: root,
          selectedFilePath: null,
          tree: fileTree,
        }),
      )

      expect(focusChanges).toContain('src/components/ui/')
      expect(fileTree.getFocusedPath()).toBe('src/components/ui/')
    } finally {
      fileTree.cleanUp()
    }
  })

  it('keeps focus inside a root lazy directory after flattened children load', () => {
    const root = 'repo'
    const initialModel = treeModel(
      tree(root, [directory('repo/docs'), directory('repo/src')]),
      root,
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: initialModel.paths,
    })

    try {
      fileTree.focusPath('src/')
      getDirectory(fileTree, 'src/').expand()

      const loadedModel = mergeDirectoryLoad(
        initialModel,
        root,
        tree('repo/src', [directory('repo/src/components')]),
        'src',
      )
      const focusChanges = focusChangesDuring(fileTree, () =>
        syncTreePaneState({
          loadExpandedDirectoriesForCurrentModel: () => {},
          model: loadedModel,
          previousPaths: initialModel.paths,
          rootPath: root,
          selectedFilePath: null,
          tree: fileTree,
        }),
      )

      expect(focusChanges).toContain('src/components/')
      expect(fileTree.getFocusedPath()).toBe('src/components/')
    } finally {
      fileTree.cleanUp()
    }
  })

  it('keeps a lazy directory expanded after its single child directory flattens into the visible row', () => {
    const root = 'repo'
    const initialModel = treeModel(tree(root, [directory('repo/src')]), root)
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: initialModel.paths,
    })

    try {
      getDirectory(fileTree, 'src/').expand()

      const loadedModel = mergeDirectoryLoad(
        initialModel,
        root,
        tree('repo/src', [directory('repo/src/components')]),
        'src',
      )

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model: loadedModel,
        previousPaths: initialModel.paths,
        rootPath: root,
        selectedFilePath: null,
        tree: fileTree,
      })

      expect(getDirectory(fileTree, 'src/components/').isExpanded()).toBe(true)
    } finally {
      fileTree.cleanUp()
    }
  })

  it('does not re-expand a collapsed flattened directory during later child syncs', () => {
    const root = 'repo'
    const initialModel = treeModel(tree(root, [directory('repo/src')]), root)
    const loadedModel = mergeDirectoryLoad(
      initialModel,
      root,
      tree('repo/src', [directory('repo/src/components')]),
      'src',
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: initialModel.paths,
    })

    try {
      getDirectory(fileTree, 'src/').expand()
      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model: loadedModel,
        previousPaths: initialModel.paths,
        rootPath: root,
        selectedFilePath: null,
        tree: fileTree,
      })
      getDirectory(fileTree, 'src/components/').collapse()

      const nestedModel = mergeDirectoryLoad(
        loadedModel,
        root,
        tree('repo/src/components', [directory('repo/src/components/ui')]),
        'src/components',
      )

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model: nestedModel,
        previousPaths: loadedModel.paths,
        rootPath: root,
        selectedFilePath: null,
        tree: fileTree,
      })

      expect(getDirectory(fileTree, 'src/components/ui/').isExpanded()).toBe(false)
    } finally {
      fileTree.cleanUp()
    }
  })

  it('reconciles multi-path changes through one ordered batch without losing tree state', () => {
    const root = 'repo'
    const initialModel = treeModel(
      tree(root, [
        directory('repo/old'),
        file('repo/old/a.ts'),
        directory('repo/src'),
        file('repo/src/existing.ts'),
        file('repo/keep.ts'),
      ]),
      root,
    )
    const nextModel = treeModel(
      tree(root, [
        directory('repo/src'),
        file('repo/src/existing.ts'),
        file('repo/src/new.ts'),
        file('repo/keep.ts'),
        file('repo/new-root.ts'),
      ]),
      root,
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: initialModel.paths,
    })
    const events: FileTreeMutationEvent[] = []
    const unsubscribe = fileTree.onMutation('*', (event) => events.push(event))

    try {
      getDirectory(fileTree, 'src/').expand()
      getFile(fileTree, 'keep.ts').select()
      events.length = 0

      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model: nextModel,
        previousPaths: initialModel.paths,
        rootPath: root,
        selectedFilePath: null,
        syncSelection: false,
        tree: fileTree,
      })

      expect(events).toHaveLength(1)
      expect(events[0]).toMatchObject({
        events: [
          { operation: 'remove', path: 'old/', recursive: true },
          { operation: 'add', path: 'new-root.ts' },
          { operation: 'add', path: 'src/new.ts' },
        ],
        operation: 'batch',
      })
      expect(fileTree.getItem('old/')).toBeNull()
      expect(fileTree.getItem('src/new.ts')).not.toBeNull()
      expect(fileTree.getSelectedPaths()).toEqual(['keep.ts'])
      expect(getDirectory(fileTree, 'src/').isExpanded()).toBe(true)
    } finally {
      unsubscribe()
      fileTree.cleanUp()
    }
  })

  it('uses prepared input for the large-drift reset fallback', () => {
    const root = 'repo'
    const initialModel = treeModel(tree(root, []), root)
    const nextModel = treeModel(
      tree(
        root,
        Array.from({ length: 513 }, (_, index) => file(`repo/file-${String(index)}.ts`)),
      ),
      root,
    )
    const fileTree = new FileTreeModel({ paths: initialModel.paths })
    const events: FileTreeMutationEvent[] = []
    const unsubscribe = fileTree.onMutation('*', (event) => events.push(event))

    try {
      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model: nextModel,
        prepareInputForPaths: preparedTreeInputForPaths,
        previousPaths: initialModel.paths,
        rootPath: root,
        selectedFilePath: null,
        tree: fileTree,
      })

      expect(events).toEqual([
        expect.objectContaining({ operation: 'reset', usedPreparedInput: true }),
      ])
      expect(fileTree.getItem('file-512.ts')).not.toBeNull()
    } finally {
      unsubscribe()
      fileTree.cleanUp()
    }
  })
})

describe('treeMutationLogContext', () => {
  it('maps every mutation shape into one bounded wide event', () => {
    const invalidation = {
      canonicalChanged: true,
      projectionChanged: true,
      visibleCountDelta: 1,
    }
    const add = { ...invalidation, operation: 'add', path: 'a.ts' } as const
    const remove = {
      ...invalidation,
      operation: 'remove',
      path: 'old/',
      recursive: true,
    } as const
    const move = { ...invalidation, from: 'a.ts', operation: 'move', to: 'b.ts' } as const
    const reset = {
      ...invalidation,
      operation: 'reset',
      pathCountAfter: 2,
      pathCountBefore: 1,
      usedPreparedInput: true,
    } as const
    const batch = { ...invalidation, events: [remove, add, move], operation: 'batch' } as const

    expect(treeMutationLogContext(add)).toMatchObject({ operation: 'add', paths: ['a.ts'] })
    expect(treeMutationLogContext(remove)).toMatchObject({ operation: 'remove', paths: ['old/'] })
    expect(treeMutationLogContext(move)).toMatchObject({
      operation: 'move',
      paths: ['a.ts', 'b.ts'],
    })
    expect(treeMutationLogContext(reset)).toMatchObject({
      operation: 'reset',
      pathCountAfter: 2,
      pathCountBefore: 1,
      usedPreparedInput: true,
    })
    expect(treeMutationLogContext(batch)).toMatchObject({
      batchChildCount: 3,
      operation: 'batch',
      paths: ['old/', 'a.ts', 'a.ts', 'b.ts'],
    })
  })
})

describe('loadExpandedDirectories', () => {
  it('does not retry an errored directory before expansion history is known', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src')]), root)
    model.errorByDirectoryPath.set('src', { message: 'Could not load' })
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    try {
      getDirectory(fileTree, 'src/').expand()
      loadExpandedDirectories(fileTree, model, (_entry, path) => loadedPaths.push(path))

      expect(loadedPaths).toEqual([])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('does not retry an errored directory while it remains expanded', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src')]), root)
    model.errorByDirectoryPath.set('src', { message: 'Could not load' })
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    try {
      getDirectory(fileTree, 'src/').expand()
      loadExpandedDirectories(
        fileTree,
        model,
        (_entry, path) => loadedPaths.push(path),
        new Set(['src']),
      )

      expect(loadedPaths).toEqual([])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('reads a loaded directory again on a fresh expand when the root is limited', () => {
    const root = 'repo'
    const model = mergeDirectoryLoad(
      treeModel(tree(root, [directory('repo/src')]), root),
      root,
      tree('repo/src', [file('repo/src/a.ts')]),
      'src',
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })
    const loads: Array<{ path: string; refresh?: boolean }> = []

    try {
      getDirectory(fileTree, 'src/').expand()
      loadExpandedDirectories(fileTree, model, () => {}, new Set(['src']), true)
      loadExpandedDirectories(
        fileTree,
        model,
        (_entry, path, options) => loads.push({ path, refresh: options?.refresh }),
        new Set(),
        true,
      )
      loadExpandedDirectories(fileTree, model, (_entry, path) => loads.push({ path }), new Set())

      expect(loads).toEqual([{ path: 'src/', refresh: true }])
    } finally {
      fileTree.cleanUp()
    }
  })

  it('retries an errored directory after a fresh expand gesture', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src')]), root)
    model.errorByDirectoryPath.set('src', { message: 'Could not load' })
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    try {
      getDirectory(fileTree, 'src/').expand()
      loadExpandedDirectories(fileTree, model, (_entry, path) => loadedPaths.push(path), new Set())

      expect(loadedPaths).toEqual(['src/'])
    } finally {
      fileTree.cleanUp()
    }
  })
})

describe('visibleTreeItemCount', () => {
  it('counts expanded tree rows instead of every loaded path', () => {
    const root = 'repo'
    const initialModel = mergeDirectoryLoad(
      treeModel(tree(root, [directory('repo/src')]), root),
      root,
      tree('repo/src', [directory('repo/src/components'), file('repo/src/index.ts')]),
      'src',
    )
    const model = mergeDirectoryLoad(
      initialModel,
      root,
      tree('repo/src/components', [file('repo/src/components/Button.tsx')]),
      'src/components',
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })

    try {
      expect(visibleTreeItemCount(fileTree, model)).toBe(1)

      getDirectory(fileTree, 'src/').expand()
      expect(visibleTreeItemCount(fileTree, model)).toBe(3)

      getDirectory(fileTree, 'src/components/').expand()
      expect(visibleTreeItemCount(fileTree, model)).toBe(4)
    } finally {
      fileTree.cleanUp()
    }
  })

  it('counts a flattened directory chain as one visible row', () => {
    const root = 'repo'
    const initialModel = mergeDirectoryLoad(
      treeModel(tree(root, [directory('repo/docs')]), root),
      root,
      tree('repo/docs', [directory('repo/docs/guide')]),
      'docs',
    )
    const model = mergeDirectoryLoad(
      initialModel,
      root,
      tree('repo/docs/guide', [file('repo/docs/guide/intro.md')]),
      'docs/guide',
    )
    const fileTree = new FileTreeModel({
      flattenEmptyDirectories: true,
      initialExpansion: 'closed',
      paths: model.paths,
    })

    try {
      expect(visibleTreeItemCount(fileTree, model)).toBe(1)

      getDirectory(fileTree, 'docs/guide/').expand()
      expect(visibleTreeItemCount(fileTree, model)).toBe(2)
    } finally {
      fileTree.cleanUp()
    }
  })
})

describe('selectedFileEntryForTreeSelection', () => {
  it('uses the most recently selected file when the tree model keeps older selections', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [file('repo/src/a.ts'), file('repo/src/b.ts')]), root)

    expect(selectedFileEntryForTreeSelection(model, ['src/a.ts', 'src/b.ts'])?.path).toBe(
      'repo/src/b.ts',
    )
  })

  it('skips selected directories when resolving the selected file', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src'), file('repo/src/a.ts')]), root)

    expect(selectedFileEntryForTreeSelection(model, ['src/a.ts', 'src/'])?.path).toBe(
      'repo/src/a.ts',
    )
  })
})

function focusChangesDuring(tree: FileTreeModel, action: () => void) {
  const paths: (string | null)[] = []
  const unsubscribe = tree.subscribe(() => {
    paths.push(tree.getFocusedPath())
  })

  try {
    action()
  } finally {
    unsubscribe()
  }

  return paths
}

function expandedDirectories(tree: FileTreeModel) {
  return ['src/', 'src/components/', 'vendor/'].filter((path) => {
    const item = tree.getItem(path)
    if (!isDirectoryHandle(item)) return false

    return item.isExpanded()
  })
}

function getDirectory(tree: FileTreeModel, path: string): FileTreeDirectoryHandle {
  const item = tree.getItem(path)
  if (!isDirectoryHandle(item)) {
    throw new Error(`Expected ${path} to be a directory`)
  }

  return item
}

function getFile(tree: FileTreeModel, path: string): FileTreeFileHandle {
  const item = tree.getItem(path)
  if (!isFileHandle(item)) {
    throw new Error(`Expected ${path} to be a file`)
  }

  return item
}

function isDirectoryHandle(item: FileTreeItemHandle | null): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true
}

function isFileHandle(item: FileTreeItemHandle | null): item is FileTreeFileHandle {
  return item?.isDirectory() === false
}

function tree(path: string, entries: TreeEntry[]): TreeResult {
  return { entries, path: filesystemPath(path) }
}

function symlinkDirectory(path: string): TreeEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    targetType: 'directory',
    type: 'symlink',
    version: `test:1:${path}`,
  }
}

function directory(path: string): TreeEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    type: 'directory',
    version: `test:1:${path}`,
  }
}

function file(path: string): TreeEntry {
  return {
    birthtimeMs: 1,
    mtimeMs: 1,
    name: path.split('/').at(-1) ?? path,
    path: filesystemPath(path),
    size: 1,
    type: 'file',
    version: `test:1:${path}`,
  }
}

describe('treeRowDecoration', () => {
  function rowAt(path: string) {
    return { item: { path } } as FileTreeRowDecorationContext
  }

  it('says no access for a folder the server may not read, and names it', () => {
    const model = treeModel(tree('repo', [directory('repo/locked')]), 'repo')
    model.errorByDirectoryPath.set('locked', { message: 'Permission denied', denied: true })

    expect(treeRowDecoration(model, rowAt('locked/'))).toEqual({
      text: 'no access',
      title: "The server's user cannot read /repo/locked",
    })
  })

  it('keeps error and loading for other folders', () => {
    const model = treeModel(
      tree('repo', [directory('repo/broken'), directory('repo/slow')]),
      'repo',
    )
    model.errorByDirectoryPath.set('broken', { message: 'Could not load' })
    model.loadingDirectoryPaths.add('slow')

    expect(treeRowDecoration(model, rowAt('broken/'))).toEqual({
      text: 'error',
      title: 'Could not load',
    })
    expect(treeRowDecoration(model, rowAt('slow/'))).toEqual({ text: 'loading' })
  })

  it('keys the repaint on what rows show, never on a clone', () => {
    const model = treeModel(tree('repo', [directory('repo/locked')]), 'repo')
    const before = treeDecorationKey(model)

    expect(treeDecorationKey(cloneTreeModel(model))).toBe(before)
    model.errorByDirectoryPath.set('locked', { message: 'Permission denied', denied: true })
    expect(treeDecorationKey(model)).not.toBe(before)
  })
})
