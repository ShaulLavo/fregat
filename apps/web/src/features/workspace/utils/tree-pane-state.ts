import {
  ancestorsOf,
  prepareFileTreeInput,
  type FileTreeModel,
  type PreparedFileTreeInput,
} from '@shaulavo/workbench-tree'

import { containerTreePath } from '@/features/workspace/utils/entry-paths'
import { isDirectoryEntry, type TreeEntry } from '@/lib/file-system-types'
import { canonicalTreePath } from '@/lib/path-formatters'
import {
  shouldLoadDirectory,
  treePathForSelectedPath,
  type DirectoryLoadOptions,
  type TreeModel,
} from '@/lib/tree-model'

export function syncTreePaneState({
  loadExpandedDirectoriesForCurrentModel,
  model,
  onRevealPath,
  previousPaths,
  prepareInputForPaths,
  rootPath,
  selectedFilePath,
  syncSelection = true,
  tree,
}: {
  loadExpandedDirectoriesForCurrentModel: (tree: FileTreeModel) => void
  model: TreeModel
  onRevealPath?: (path: string) => void
  previousPaths: readonly string[]
  prepareInputForPaths?: (paths: readonly string[]) => PreparedFileTreeInput
  rootPath: string
  selectedFilePath: string | null
  syncSelection?: boolean
  tree: FileTreeModel
}) {
  syncTreePaths(tree, previousPaths, model.paths, model, prepareInputForPaths)
  const selectedTreePath = syncSelection
    ? syncSelectedFilePath(tree, rootPath, selectedFilePath)
    : null
  loadExpandedDirectoriesForCurrentModel(tree)
  if (selectedTreePath) {
    onRevealPath?.(selectedTreePath)
  }

  return model.paths
}

/** `refreshOnExpand`: a fresh expand reads a loaded folder again, for roots nothing watches below the top. */
export function loadExpandedDirectories(
  tree: FileTreeModel,
  model: TreeModel,
  onLoadDirectory: (entry: TreeEntry, treePath: string, options?: DirectoryLoadOptions) => void,
  previousExpandedDirectoryPaths?: ReadonlySet<string>,
  refreshOnExpand = false,
) {
  const expandedPaths = expandedDirectoryPathSet(model, tree)

  for (const [treePath, entry] of model.entriesByTreePath) {
    if (!isDirectoryEntry(entry)) continue
    const canonicalDirectoryPath = canonicalTreePath(treePath)
    if (!expandedPaths.has(canonicalDirectoryPath)) continue

    const directoryTreePath = `${canonicalDirectoryPath}/`
    const retry = previousExpandedDirectoryPaths?.has(canonicalDirectoryPath) === false
    const options = { retry, refresh: retry && refreshOnExpand }
    if (!shouldLoadDirectory(model, directoryTreePath, options)) continue

    onLoadDirectory(entry, directoryTreePath, options)
  }

  return expandedPaths
}

export function visibleTreeItemCount(tree: FileTreeModel): number {
  let count = 0
  for (const row of tree.getSnapshot().rows) {
    if (row.type === 'entry') count += 1
  }
  return count
}

export function expandTreeDirectory(tree: FileTreeModel, treePath: string): void {
  const canonical = canonicalTreePath(treePath)
  if (!canonical) return
  if (tree.getSnapshot().expanded.has(canonical)) return

  tree.setExpanded(canonical, true)
}

function syncSelectedFilePath(
  tree: FileTreeModel,
  rootPath: string,
  selectedFilePath: string | null,
): string | null {
  if (!selectedFilePath) {
    tree.clearSelection()
    return null
  }

  const treePath = treePathForSelectedPath(rootPath, selectedFilePath)
  if (!treePath) {
    tree.clearSelection()
    return null
  }

  const canonicalPath = canonicalTreePath(treePath)
  expandKnownAncestorDirectories(tree, canonicalPath)
  const kind = tree.index.getKind(canonicalPath)
  if (kind !== 'file') return null
  if (tree.getSelectedPaths().includes(canonicalPath)) return canonicalPath

  tree.setSelectedPaths([canonicalPath])
  return canonicalPath
}

function expandKnownAncestorDirectories(tree: FileTreeModel, treePath: string): void {
  for (const directoryPath of ancestorsOf(treePath)) {
    if (tree.index.getKind(directoryPath) !== 'directory') continue
    if (tree.getSnapshot().expanded.has(directoryPath)) continue

    tree.setExpanded(directoryPath, true)
  }
}

type TreeChild = {
  entry: TreeEntry
  treePath: string
}

function syncTreePaths(
  tree: FileTreeModel,
  previousPaths: readonly string[],
  nextPaths: readonly string[],
  model: TreeModel,
  prepareInputForPaths?: (paths: readonly string[]) => PreparedFileTreeInput,
) {
  if (previousPaths === nextPaths) return

  const previousPathSet = new Set(previousPaths)
  const nextPathSet = new Set(nextPaths)
  const added = nextPaths.filter((path) => !previousPathSet.has(path))
  const removed = previousPaths.filter((path) => !nextPathSet.has(path))
  if (added.length === 0 && removed.length === 0) return

  const expandedBeforeSync = new Set(tree.getExpandedPaths().map(canonicalTreePath))
  const focusedBeforeSync = tree.getSnapshot().focusedPath ?? null
  const preparedInput = prepareInputForPaths
    ? prepareInputForPaths(nextPaths)
    : prepareFileTreeInput(nextPaths)

  tree.replacePreparedInput(preparedInput)
  followFlattenedDirectoryTerminals(tree, model, added, expandedBeforeSync, focusedBeforeSync)
}

function followFlattenedDirectoryTerminals(
  tree: FileTreeModel,
  model: TreeModel,
  addedPaths: readonly string[],
  expandedPathsBeforeSync: ReadonlySet<string>,
  focusedBeforeSync: string | null,
) {
  const addedDirectoryPaths = addedDirectoryPathSet(addedPaths)
  if (addedDirectoryPaths.size === 0) return

  const childrenByParent = treeChildrenByParentPath(model)
  for (const expandedPath of expandedPathsBeforeSync) {
    const terminalPath = flattenedTerminalDirectoryPath(expandedPath, childrenByParent, model)
    if (terminalPath === expandedPath) continue
    if (containerTreePath(terminalPath, false) !== expandedPath) continue
    if (!addedDirectoryPaths.has(terminalPath)) continue

    tree.setExpanded(terminalPath, true)
    if (focusedBeforeSync === expandedPath) {
      tree.setFocusedPath(terminalPath)
    }
  }
}

function treeChildrenByParentPath(model: TreeModel) {
  const childrenByParent = new Map<string, TreeChild[]>()

  for (const [treePath, entry] of model.entriesByTreePath) {
    const parentPath = containerTreePath(treePath, false)
    const children = childrenByParent.get(parentPath) ?? []
    children.push({ entry, treePath })
    childrenByParent.set(parentPath, children)
  }

  return childrenByParent
}

function flattenedTerminalDirectoryPath(
  treePath: string,
  childrenByParent: ReadonlyMap<string, readonly TreeChild[]>,
  model: TreeModel,
) {
  let currentPath = canonicalTreePath(treePath)

  while (true) {
    const nextPath = flattenedChildDirectoryPath(currentPath, childrenByParent, model)
    if (!nextPath) return currentPath

    currentPath = nextPath
  }
}

function flattenedChildDirectoryPath(
  treePath: string,
  childrenByParent: ReadonlyMap<string, readonly TreeChild[]>,
  model: TreeModel,
) {
  const children = childrenByParent.get(treePath)
  if (children?.length !== 1) return null

  const child = children[0]
  if (!child) return null
  if (!isDirectoryEntry(child.entry)) return null
  if (!model.entriesByTreePath.has(child.treePath)) return null

  return child.treePath
}

function expandedDirectoryPathSet(model: TreeModel, tree: FileTreeModel) {
  const expanded = tree.getSnapshot().expanded
  const paths = new Set<string>()

  for (const [treePath, entry] of model.entriesByTreePath) {
    if (!isDirectoryEntry(entry)) continue
    const canonical = canonicalTreePath(treePath)
    if (!expanded.has(canonical)) continue

    paths.add(canonical)
  }

  return paths
}

function addedDirectoryPathSet(paths: readonly string[]) {
  const directoryPaths = new Set<string>()

  for (const path of paths) {
    if (!path.endsWith('/')) continue

    directoryPaths.add(canonicalTreePath(path))
  }

  return directoryPaths
}
