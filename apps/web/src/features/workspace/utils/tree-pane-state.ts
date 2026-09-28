import type {
  FileTreeBatchOperation,
  FileTreeDirectoryHandle,
  FileTreeItemHandle,
  FileTreeScrollToPathOptions,
} from '@workspace/tree'
import type { FileTreePreparedInput } from '@workspace/tree'
import type { TreeViewModel } from '@/features/workspace/state/tree-model'

import type { TreeEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { ancestorDirectoryPaths } from '@workspace/utils/slash-paths'
import { canonicalTreePath } from '@/lib/path-formatters'
import { containerTreePath } from '@/features/workspace/utils/entry-paths'
import {
  type DirectoryLoadOptions,
  shouldLoadDirectory,
  treePathForSelectedPath,
  type TreeModel,
} from '@/lib/tree-model'

export function syncTreePaneState({
  loadExpandedDirectoriesForCurrentModel,
  model,
  previousPaths,
  prepareInputForPaths,
  rootPath,
  scrollBehavior = 'smooth',
  syncSelection = true,
  selectedFilePath,
  tree,
}: {
  loadExpandedDirectoriesForCurrentModel: (tree: TreeViewModel) => void
  model: TreeModel
  previousPaths: readonly string[]
  prepareInputForPaths?: (paths: readonly string[]) => FileTreePreparedInput
  rootPath: string
  scrollBehavior?: FileTreeScrollToPathOptions['behavior']
  syncSelection?: boolean
  selectedFilePath: string | null
  tree: TreeViewModel
}) {
  syncTreePaths(tree, previousPaths, model.paths, model, prepareInputForPaths)
  const selectedTreePath = syncSelection
    ? syncSelectedFilePath(tree, rootPath, selectedFilePath)
    : null
  loadExpandedDirectoriesForCurrentModel(tree)
  if (selectedTreePath) {
    tree.scrollToPath(selectedTreePath, {
      behavior: scrollBehavior,
      focus: false,
      offset: 'nearest',
    })
  }

  return model.paths
}

/** `refreshOnExpand`: a fresh expand reads a loaded folder again, for roots nothing watches below the top. */
export function loadExpandedDirectories(
  tree: TreeViewModel,
  model: TreeModel,
  onLoadDirectory: (entry: TreeEntry, treePath: string, options?: DirectoryLoadOptions) => void,
  previousExpandedDirectoryPaths?: ReadonlySet<string>,
  refreshOnExpand = false,
) {
  const expandedPaths = expandedDirectoryPathSet(model, tree)

  for (const [treePath, entry] of model.entriesByTreePath) {
    if (!isDirectoryEntry(entry)) continue
    const directoryTreePath = `${canonicalTreePath(treePath)}/`
    const canonicalDirectoryPath = canonicalTreePath(directoryTreePath)
    if (!expandedPaths.has(canonicalDirectoryPath)) continue

    const retry = previousExpandedDirectoryPaths?.has(canonicalDirectoryPath) === false
    const options = { retry, refresh: retry && refreshOnExpand }
    if (!shouldLoadDirectory(model, directoryTreePath, options)) continue

    onLoadDirectory(entry, directoryTreePath, options)
  }

  return expandedPaths
}

export function visibleTreeItemCount(tree: TreeViewModel, model: TreeModel) {
  const childrenByParent = treeChildrenByParentPath(model)

  return visibleChildrenCount({
    childrenByParent,
    model,
    parentPath: '',
    tree,
  })
}

function syncSelectedFilePath(
  tree: TreeViewModel,
  rootPath: string,
  selectedFilePath: string | null,
) {
  if (!selectedFilePath) {
    clearTreeSelection(tree)
    return null
  }

  const treePath = treePathForSelectedPath(rootPath, selectedFilePath)
  if (!treePath) {
    clearTreeSelection(tree)
    return null
  }

  const canonicalPath = canonicalTreePath(treePath)
  expandKnownAncestorDirectories(tree, canonicalPath)
  const item = tree.getItem(canonicalPath)
  if (!item || item.isDirectory()) return null
  if (tree.getSelectedPaths().includes(canonicalPath)) return canonicalPath

  clearTreeSelection(tree)
  item.select()
  return canonicalPath
}

function clearTreeSelection(tree: TreeViewModel) {
  for (const selectedPath of tree.getSelectedPaths()) {
    tree.getItem(selectedPath)?.deselect()
  }
}

type TreeChild = {
  entry: TreeEntry
  treePath: string
}

type VisibleChildrenCountOptions = {
  childrenByParent: ReadonlyMap<string, readonly TreeChild[]>
  model: TreeModel
  parentPath: string
  tree: TreeViewModel
}

function visibleChildrenCount({
  childrenByParent,
  model,
  parentPath,
  tree,
}: VisibleChildrenCountOptions) {
  let count = 0

  for (const child of childrenByParent.get(parentPath) ?? []) {
    count += visibleChildCount({ child, childrenByParent, model, tree })
  }

  return count
}

function visibleChildCount({
  child,
  childrenByParent,
  model,
  tree,
}: Omit<VisibleChildrenCountOptions, 'parentPath'> & { child: TreeChild }) {
  if (!isDirectoryEntry(child.entry)) return 1

  const terminalPath = flattenedTerminalDirectoryPath(child.treePath, childrenByParent, model)
  if (!isTreeDirectoryExpanded(tree, terminalPath)) return 1

  return (
    1 +
    visibleChildrenCount({
      childrenByParent,
      model,
      parentPath: terminalPath,
      tree,
    })
  )
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

const INCREMENTAL_TREE_SYNC_LIMIT = 512

type TreePathChanges = {
  added: string[]
  removed: string[]
}

function syncTreePaths(
  tree: TreeViewModel,
  previousPaths: readonly string[],
  nextPaths: readonly string[],
  model: TreeModel,
  prepareInputForPaths?: (paths: readonly string[]) => FileTreePreparedInput,
) {
  const changes = treePathChanges(previousPaths, nextPaths)
  if (changes.added.length === 0 && changes.removed.length === 0) return
  const expandedPathsBeforeSync = expandedDirectoryPathSet(model, tree)

  if (shouldResetTreePaths(changes)) {
    resetTreePaths(tree, nextPaths, model, prepareInputForPaths)
    return
  }

  // An inline rename or a drop has already moved its row, and a pending intent
  // projects the same move; only the difference from the live tree is applied.
  const operations = treePathBatchOperations(changesAgainstLiveTree(tree, changes))
  if (operations.length === 0) return

  tree.batch(operations)

  expandNewFlattenedDirectoryTerminals(tree, model, changes.added, expandedPathsBeforeSync)
}

function treePathChanges(
  previousPaths: readonly string[],
  nextPaths: readonly string[],
): TreePathChanges {
  const previousPathSet = new Set(previousPaths)
  const nextPathSet = new Set(nextPaths)

  return {
    added: nextPaths.filter((path) => !previousPathSet.has(path)),
    removed: previousPaths.filter((path) => !nextPathSet.has(path)),
  }
}

function shouldResetTreePaths({ added, removed }: TreePathChanges) {
  return added.length + removed.length > INCREMENTAL_TREE_SYNC_LIMIT
}

function resetTreePaths(
  tree: TreeViewModel,
  paths: readonly string[],
  model: TreeModel,
  prepareInputForPaths?: (paths: readonly string[]) => FileTreePreparedInput,
) {
  const initialExpandedPaths = expandedDirectoryPaths(model, tree)
  const preparedInput = prepareInputForPaths?.(paths)
  if (!preparedInput) {
    tree.resetPaths(paths, { initialExpandedPaths })
    return
  }

  tree.resetPaths(preparedInput.paths, { initialExpandedPaths, preparedInput })
}

function treePathBatchOperations(changes: TreePathChanges): readonly FileTreeBatchOperation[] {
  const operations: FileTreeBatchOperation[] = []
  for (const path of topLevelRemovedPaths(changes.removed)) {
    operations.push(
      path.endsWith('/') ? { path, recursive: true, type: 'remove' } : { path, type: 'remove' },
    )
  }
  for (const path of sortedTreePathsByDepth(changes.added)) {
    operations.push({ path, type: 'add' })
  }

  return operations
}

function changesAgainstLiveTree(tree: TreeViewModel, changes: TreePathChanges): TreePathChanges {
  return {
    added: changes.added.filter((path) => !treeHasPath(tree, path)),
    removed: changes.removed.filter((path) => treeHasPath(tree, path)),
  }
}

function topLevelRemovedPaths(paths: readonly string[]) {
  const removedPathSet = new Set(paths)

  return sortedTreePathsByDepth(paths).filter((path) => !hasRemovedAncestor(path, removedPathSet))
}

function hasRemovedAncestor(path: string, removedPathSet: ReadonlySet<string>) {
  return ancestorDirectoryPaths(path).some((ancestorPath) => removedPathSet.has(ancestorPath))
}

function sortedTreePathsByDepth(paths: readonly string[]) {
  return paths.toSorted((left, right) => treePathDepth(left) - treePathDepth(right))
}

function treePathDepth(path: string) {
  return canonicalTreePath(path).split('/').filter(Boolean).length
}

function treeHasPath(tree: TreeViewModel, path: string) {
  return tree.getItem(path) !== null
}

function expandKnownAncestorDirectories(tree: TreeViewModel, treePath: string) {
  for (const directoryPath of ancestorDirectoryPaths(treePath)) {
    const item = tree.getItem(directoryPath)
    if (!isTreeDirectoryHandle(item)) continue
    if (item.isExpanded()) continue

    item.expand()
  }
}

function expandedDirectoryPaths(model: TreeModel, tree: TreeViewModel) {
  const paths: string[] = []
  const expandedPaths = expandedDirectoryPathSet(model, tree)
  const childrenByParent = treeChildrenByParentPath(model)

  for (const treePath of expandedPaths) {
    paths.push(`${treePath}/`)

    const terminalPath = flattenedTerminalDirectoryPath(treePath, childrenByParent, model)
    if (terminalPath === treePath) continue
    if (containerTreePath(terminalPath, false) !== treePath) continue

    paths.push(`${terminalPath}/`)
  }

  return paths
}

function expandedDirectoryPathSet(model: TreeModel, tree: TreeViewModel) {
  const paths = new Set<string>()

  for (const [treePath, entry] of model.entriesByTreePath) {
    if (!isDirectoryEntry(entry)) continue
    if (!isTreeDirectoryExpanded(tree, treePath)) continue

    paths.add(canonicalTreePath(treePath))
  }

  return paths
}

function expandNewFlattenedDirectoryTerminals(
  tree: TreeViewModel,
  model: TreeModel,
  addedPaths: readonly string[],
  expandedPathsBeforeSync: ReadonlySet<string>,
) {
  const addedDirectoryPaths = addedDirectoryPathSet(addedPaths)
  if (addedDirectoryPaths.size === 0) return

  const childrenByParent = treeChildrenByParentPath(model)
  for (const expandedPath of expandedPathsBeforeSync) {
    const terminalPath = flattenedTerminalDirectoryPath(expandedPath, childrenByParent, model)
    if (terminalPath === expandedPath) continue
    if (containerTreePath(terminalPath, false) !== expandedPath) continue
    if (!addedDirectoryPaths.has(terminalPath)) continue

    expandTreeDirectory(tree, terminalPath)
  }
}

function addedDirectoryPathSet(paths: readonly string[]) {
  const directoryPaths = new Set<string>()

  for (const path of paths) {
    if (!path.endsWith('/')) continue

    directoryPaths.add(canonicalTreePath(path))
  }

  return directoryPaths
}

export function expandTreeDirectory(tree: TreeViewModel, treePath: string) {
  const item = tree.getItem(`${treePath}/`) ?? tree.getItem(treePath)
  if (!isTreeDirectoryHandle(item)) return
  if (item.isExpanded()) return

  item.expand()
}

function isTreeDirectoryExpanded(tree: TreeViewModel, treePath: string) {
  const item = tree.getItem(`${treePath}/`) ?? tree.getItem(treePath)
  if (!isTreeDirectoryHandle(item)) return false

  return item.isExpanded()
}

function isTreeDirectoryHandle(item: FileTreeItemHandle | null): item is FileTreeDirectoryHandle {
  return item?.isDirectory() === true
}
