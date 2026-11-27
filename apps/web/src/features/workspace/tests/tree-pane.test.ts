import { FileTreeModel } from '@shaulavo/workbench-tree'
import { describe } from 'vitest'

import { preparedTreeInputForPaths } from '@/features/workspace/state/prepared-tree-input-cache'
import { fileTreeGitState } from '@/features/workspace/utils/git-state-for-tree'
import { treeDecorationKey, treeRowDecoration } from '@/features/workspace/utils/tree-decoration'
import {
  loadExpandedDirectories,
  syncTreePaneState,
  visibleTreeItemCount,
} from '@/features/workspace/utils/tree-pane-state'
import { selectedFileEntryForTreeSelection } from '@/features/workspace/utils/tree-selection'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import { cloneTreeModel, mergeDirectoryLoad, treeModel } from '@/lib/tree-model'

import { expect, test as it } from '../../../../test/fixtures'

describe('syncTreePaneState', () => {
  it('continues expanding newly loaded ancestors for the selected file', () => {
    const root = 'repo'
    const selectedFilePath = 'repo/src/components/Button.tsx'
    const initialModel = treeModel(tree(root, [directory('repo/src')]), root)
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: initialModel.paths,
    })
    const loadPasses: string[][] = []

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

    expect(loadPasses).toEqual([['src'], ['src', 'src/components']])
  })

  it('loads expanded symlink directory targets', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [symlinkDirectory('repo/vendor')]), root)
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    fileTree.setExpanded('vendor', true)

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
  })

  it('does not rewrite tree selection when the selected file is already selected', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [file('repo/src/a.ts'), file('repo/src/b.ts')]), root)
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })

    fileTree.setSelectedPaths(['src/a.ts', 'src/b.ts'])

    syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel: () => {},
      model,
      previousPaths: model.paths,
      rootPath: root,
      selectedFilePath: 'repo/src/b.ts',
      tree: fileTree,
    })

    expect(fileTree.getSelectedPaths()).toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('does not reselect the active editor file during tree-only syncs', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src'), file('repo/src/a.ts')]), root)
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })

    fileTree.setSelectedPaths(['src'])

    syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel: () => {},
      model,
      previousPaths: model.paths,
      rootPath: root,
      selectedFilePath: 'repo/src/a.ts',
      syncSelection: false,
      tree: fileTree,
    })

    expect(fileTree.getSelectedPaths()).toEqual(['src'])
  })

  it('skips stale removals and additions cleanly', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/packages/editor-find')]), root)
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })

    expect(() => {
      syncTreePaneState({
        loadExpandedDirectoriesForCurrentModel: () => {},
        model,
        previousPaths: model.paths.concat(['packages/editor-find/.turbo/']),
        rootPath: root,
        selectedFilePath: null,
        tree: fileTree,
      })
    }).not.toThrow()
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
      compactFolders: true,
      paths: initialModel.paths,
    })

    fileTree.setExpanded('src', true)
    fileTree.setFocusedPath('src/components')
    fileTree.setExpanded('src/components', true)

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

    expect(focusChanges).toContain('src/components/ui')
    expect(fileTree.getSnapshot().focusedPath).toBe('src/components/ui')
  })

  it('keeps focus inside a root lazy directory after flattened children load', () => {
    const root = 'repo'
    const initialModel = treeModel(
      tree(root, [directory('repo/docs'), directory('repo/src')]),
      root,
    )
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: initialModel.paths,
    })

    fileTree.setFocusedPath('src')
    fileTree.setExpanded('src', true)

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

    expect(focusChanges).toContain('src/components')
    expect(fileTree.getSnapshot().focusedPath).toBe('src/components')
  })

  it('keeps a lazy directory expanded after its single child directory flattens into the visible row', () => {
    const root = 'repo'
    const initialModel = treeModel(tree(root, [directory('repo/src')]), root)
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: initialModel.paths,
    })

    fileTree.setExpanded('src', true)

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

    expect(fileTree.getSnapshot().expanded.has('src/components')).toBe(true)
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
      compactFolders: true,
      paths: initialModel.paths,
    })

    fileTree.setExpanded('src', true)
    syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel: () => {},
      model: loadedModel,
      previousPaths: initialModel.paths,
      rootPath: root,
      selectedFilePath: null,
      tree: fileTree,
    })
    fileTree.setExpanded('src/components', false)

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

    expect(fileTree.getSnapshot().expanded.has('src/components/ui')).toBe(false)
  })

  it('reconciles multi-path changes without losing expansion or selection state', () => {
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
      compactFolders: true,
      paths: initialModel.paths,
    })

    fileTree.setExpanded('src', true)
    fileTree.setSelectedPaths(['keep.ts'])

    syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel: () => {},
      model: nextModel,
      prepareInputForPaths: preparedTreeInputForPaths,
      previousPaths: initialModel.paths,
      rootPath: root,
      selectedFilePath: null,
      syncSelection: false,
      tree: fileTree,
    })

    expect(fileTree.index.getKind('old')).toBeUndefined()
    expect(fileTree.index.getKind('src/new.ts')).toBe('file')
    expect(fileTree.getSelectedPaths()).toEqual(['keep.ts'])
    expect(fileTree.getSnapshot().expanded.has('src')).toBe(true)
  })

  it('uses prepared input for large-drift replacements', () => {
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

    syncTreePaneState({
      loadExpandedDirectoriesForCurrentModel: () => {},
      model: nextModel,
      prepareInputForPaths: preparedTreeInputForPaths,
      previousPaths: initialModel.paths,
      rootPath: root,
      selectedFilePath: null,
      tree: fileTree,
    })

    expect(fileTree.index.getKind('file-512.ts')).toBe('file')
  })
})

describe('fileTreeGitState', () => {
  it('rolls up changed ancestor directories and tracks ignored directories separately', () => {
    const state = fileTreeGitState([
      { path: 'src/components/Button.tsx', status: 'modified' },
      { path: 'dist/', status: 'ignored' },
    ])

    expect(state.statusByPath.get('src/components/Button.tsx')).toBe('modified')
    expect(state.directoriesWithChanges.has('src')).toBe(true)
    expect(state.directoriesWithChanges.has('src/components')).toBe(true)
    expect(state.ignoredDirectories.has('dist')).toBe(true)
    expect(state.directoriesWithChanges.has('dist')).toBe(false)
  })
})

describe('loadExpandedDirectories', () => {
  it('does not retry an errored directory before expansion history is known', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src')]), root)
    model.errorByDirectoryPath.set('src', { message: 'Could not load' })
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    fileTree.setExpanded('src', true)
    loadExpandedDirectories(fileTree, model, (_entry, path) => loadedPaths.push(path))

    expect(loadedPaths).toEqual([])
  })

  it('does not retry an errored directory while it remains expanded', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src')]), root)
    model.errorByDirectoryPath.set('src', { message: 'Could not load' })
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    fileTree.setExpanded('src', true)
    loadExpandedDirectories(
      fileTree,
      model,
      (_entry, path) => loadedPaths.push(path),
      new Set(['src']),
    )

    expect(loadedPaths).toEqual([])
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
      compactFolders: true,
      paths: model.paths,
    })
    const loads: Array<{ path: string; refresh?: boolean }> = []

    fileTree.setExpanded('src', true)
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
  })

  it('retries an errored directory after a fresh expand gesture', () => {
    const root = 'repo'
    const model = treeModel(tree(root, [directory('repo/src')]), root)
    model.errorByDirectoryPath.set('src', { message: 'Could not load' })
    const fileTree = new FileTreeModel({
      compactFolders: true,
      paths: model.paths,
    })
    const loadedPaths: string[] = []

    fileTree.setExpanded('src', true)
    loadExpandedDirectories(fileTree, model, (_entry, path) => loadedPaths.push(path), new Set())

    expect(loadedPaths).toEqual(['src/'])
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
      compactFolders: true,
      paths: model.paths,
    })

    expect(visibleTreeItemCount(fileTree)).toBe(1)

    fileTree.setExpanded('src', true)
    expect(visibleTreeItemCount(fileTree)).toBe(3)

    fileTree.setExpanded('src/components', true)
    expect(visibleTreeItemCount(fileTree)).toBe(4)
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
      compactFolders: true,
      paths: model.paths,
    })

    expect(visibleTreeItemCount(fileTree)).toBe(1)

    fileTree.setExpanded('docs/guide', true)
    expect(visibleTreeItemCount(fileTree)).toBe(2)
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

describe('treeRowDecoration', () => {
  function noFix() {}

  it('says no access for a folder the server may not read, and names it', () => {
    const model = treeModel(tree('repo', [directory('repo/locked')]), 'repo')
    model.errorByDirectoryPath.set('locked', { message: 'Permission denied', denied: true })

    const handed: unknown[] = []
    const decoration = treeRowDecoration(model, 'locked', (error) => handed.push(error))

    expect(decoration).toMatchObject({
      text: 'no access',
      title: "The server's user cannot read /repo/locked",
      action: { label: 'Fix with AI' },
    })
    decoration?.action?.onActivate()
    expect(handed).toEqual([
      {
        code: 'PERMISSION_DENIED',
        message: "The server's user cannot read /repo/locked",
        title: 'The file tree has no access to a folder',
      },
    ])
  })

  it('keeps error and loading for other folders', () => {
    const model = treeModel(
      tree('repo', [directory('repo/broken'), directory('repo/slow')]),
      'repo',
    )
    model.errorByDirectoryPath.set('broken', { message: 'Could not load' })
    model.loadingDirectoryPaths.add('slow')

    expect(treeRowDecoration(model, 'broken', noFix)).toMatchObject({
      text: 'error',
      title: 'Could not load',
      action: { label: 'Fix with AI' },
    })
    expect(treeRowDecoration(model, 'slow', noFix)).toEqual({ text: 'loading' })
  })

  it('keys the repaint on what rows show, never on a clone', () => {
    const model = treeModel(tree('repo', [directory('repo/locked')]), 'repo')
    const before = treeDecorationKey(model)

    expect(treeDecorationKey(cloneTreeModel(model))).toBe(before)
    model.errorByDirectoryPath.set('locked', { message: 'Permission denied', denied: true })
    expect(treeDecorationKey(model)).not.toBe(before)
  })
})

function focusChangesDuring(tree: FileTreeModel, action: () => void) {
  const paths: (string | null)[] = []
  const unsubscribe = tree.subscribe(() => {
    paths.push(tree.getSnapshot().focusedPath ?? null)
  })

  try {
    action()
  } finally {
    unsubscribe()
  }

  return paths
}

function expandedDirectories(tree: FileTreeModel) {
  const expanded = tree.getSnapshot().expanded
  return ['src', 'src/components', 'vendor'].filter((path) => expanded.has(path))
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
