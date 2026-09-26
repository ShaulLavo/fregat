import { filesystemPath } from '@/lib/documents/utils/identity'
import type { TreeEntry, TreeResult } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { canonicalTreePath, toTreePath } from '@/lib/path-formatters'

/** Why a directory's children could not be listed; `denied` means the server may not read it. */
export type DirectoryLoadError = {
  readonly message: string
  readonly denied?: boolean
}

export type TreeModel = {
  paths: string[]
  entriesByTreePath: Map<string, TreeEntry>
  errorByDirectoryPath: Map<string, DirectoryLoadError>
  loadedDirectoryPaths: Set<string>
  loadingDirectoryPaths: Set<string>
}

export type TreePathMove = {
  fromTreePath: string
  toTreePath: string
}

export type DirectoryLoadOptions = {
  retry?: boolean
  /** Read a loaded directory again; a limited root has no watch to say what changed in it. */
  refresh?: boolean
}

export function treeModel(result: TreeResult, rootPath: string): TreeModel {
  const entriesByTreePath = new Map<string, TreeEntry>()
  const paths: string[] = []
  addFlattenedTreeEntries(paths, result.entries, rootPath, entriesByTreePath)

  return {
    paths,
    entriesByTreePath,
    errorByDirectoryPath: new Map(),
    loadedDirectoryPaths: new Set(),
    loadingDirectoryPaths: new Set(),
  }
}

export function treeModelWithDirectoryLoads(
  result: TreeResult,
  rootPath: string,
  directoryResults: readonly TreeResult[],
): TreeModel {
  return mergeDirectoryLoads(treeModel(result, rootPath), rootPath, directoryResults)
}

function mergeDirectoryLoads(model: TreeModel, rootPath: string, results: readonly TreeResult[]) {
  if (results.length === 0) return model

  const next = cloneTreeModel(model)
  for (const result of results) {
    applyDirectoryLoad(next, rootPath, result, directoryTreePathForResult(result.path, rootPath))
  }
  next.paths = pathsFromEntries(next.entriesByTreePath)

  return next
}

export function shouldLoadDirectory(
  model: TreeModel,
  treePath: string,
  options: DirectoryLoadOptions = {},
) {
  const canonicalPath = canonicalTreePath(treePath)
  if (model.loadedDirectoryPaths.has(canonicalPath) && !options.refresh) return false
  if (model.loadingDirectoryPaths.has(canonicalPath)) return false
  if (model.errorByDirectoryPath.has(canonicalPath) && !options.retry) return false

  return true
}

export function markDirectoryLoading(model: TreeModel, directoryTreePath: string): TreeModel {
  const next = cloneTreeModel(model)
  next.errorByDirectoryPath.delete(directoryTreePath)
  next.loadingDirectoryPaths.add(directoryTreePath)
  return next
}

export function markDirectoryError(
  model: TreeModel,
  directoryTreePath: string,
  error: DirectoryLoadError,
): TreeModel {
  const next = cloneTreeModel(model)
  next.loadingDirectoryPaths.delete(directoryTreePath)
  next.errorByDirectoryPath.set(directoryTreePath, error)

  return next
}

export function mergeDirectoryLoad(
  model: TreeModel,
  rootPath: string,
  result: TreeResult,
  directoryTreePath: string,
): TreeModel {
  const next = cloneTreeModel(model)
  applyDirectoryLoad(next, rootPath, result, directoryTreePath)
  next.paths = pathsFromEntries(next.entriesByTreePath)

  return next
}

export function replaceDirectoryLoad(
  model: TreeModel,
  rootPath: string,
  result: TreeResult,
): TreeModel {
  const directoryTreePath = directoryTreePathForResult(result.path, rootPath)
  const next = cloneTreeModel(model)

  const retainedDirectories = new Set<string>()
  collectUnlistedDirectories(model, result.entries, rootPath, retainedDirectories)
  removeDirectoryChildren(next, directoryTreePath, retainedDirectories)
  addEntriesToModel(next, result.entries, rootPath)
  next.loadingDirectoryPaths.delete(directoryTreePath)
  next.errorByDirectoryPath.delete(directoryTreePath)
  if (directoryTreePath) next.loadedDirectoryPaths.add(directoryTreePath)
  next.paths = pathsFromEntries(next.entriesByTreePath)

  return next
}

export function patchTreeEntryMetadata(
  model: TreeModel,
  rootPath: string,
  entry: TreeEntry,
): TreeModel {
  const treePath = canonicalTreePath(toTreePath(entry.path, rootPath))
  const current = model.entriesByTreePath.get(treePath)
  if (!current) return model

  const next = cloneTreeModel(model)
  next.entriesByTreePath.set(treePath, {
    ...entry,
    children: current.children,
  })
  return next
}

export function moveTreeModelPaths(
  model: TreeModel,
  rootPath: string,
  moves: readonly TreePathMove[],
): TreeModel {
  const normalizedMoves = normalizedTreePathMoves(moves)
  if (normalizedMoves.length === 0) return model

  return normalizedMoves.reduce(
    (currentModel, move) => moveTreeModelPath(currentModel, rootPath, move),
    model,
  )
}

export function entryForTreePath(model: TreeModel, treePath: string | undefined) {
  if (!treePath) return null

  return model.entriesByTreePath.get(canonicalTreePath(treePath)) ?? null
}

export function treePathForSelectedPath(rootPath: string, selectedFilePath: string) {
  return toTreePath(selectedFilePath, rootPath)
}

function addFlattenedTreeEntries(
  paths: string[],
  entries: TreeEntry[],
  rootPath: string,
  entriesByTreePath: Map<string, TreeEntry>,
) {
  for (const entry of entries) {
    const treePath = toTreePath(entry.path, rootPath)
    if (!treePath) continue

    const canonicalPath = canonicalTreePath(treePath)
    entriesByTreePath.set(canonicalPath, entry)
    paths.push(isDirectoryEntry(entry) ? `${canonicalPath}/` : canonicalPath)

    if (!entry.children) continue

    addFlattenedTreeEntries(paths, entry.children, rootPath, entriesByTreePath)
  }
}

function addEntriesToModel(model: TreeModel, entries: TreeEntry[], rootPath: string) {
  for (const entry of entries) {
    const treePath = toTreePath(entry.path, rootPath)
    if (!treePath) continue

    const canonicalPath = canonicalTreePath(treePath)
    model.entriesByTreePath.set(canonicalPath, entry)
    if (!entry.children) continue

    model.loadedDirectoryPaths.add(canonicalPath)
    addEntriesToModel(model, entry.children, rootPath)
  }
}

function applyDirectoryLoad(
  model: TreeModel,
  rootPath: string,
  result: TreeResult,
  directoryTreePath: string,
) {
  addEntriesToModel(model, result.entries, rootPath)
  model.loadingDirectoryPaths.delete(directoryTreePath)
  model.errorByDirectoryPath.delete(directoryTreePath)
  model.loadedDirectoryPaths.add(directoryTreePath)
}

// A shallow listing says nothing about the contents of directories that still exist.
function collectUnlistedDirectories(
  model: TreeModel,
  entries: readonly TreeEntry[],
  rootPath: string,
  retained: Set<string>,
) {
  for (const entry of entries) {
    if (!isDirectoryEntry(entry)) continue
    if (entry.children) {
      collectUnlistedDirectories(model, entry.children, rootPath, retained)
      continue
    }
    const treePath = canonicalTreePath(toTreePath(entry.path, rootPath))
    const previous = model.entriesByTreePath.get(treePath)
    if (previous && isDirectoryEntry(previous)) retained.add(treePath)
  }
}

function hasRetainedDirectory(treePath: string, retained: ReadonlySet<string>) {
  let path = treePath
  while (path) {
    if (retained.has(path)) return true
    const separator = path.lastIndexOf('/')
    if (separator < 0) return false
    path = path.slice(0, separator)
  }
  return false
}

function removeDirectoryChildren(
  model: TreeModel,
  directoryTreePath: string,
  retained: ReadonlySet<string>,
) {
  const shouldRemove = (treePath: string) =>
    isDirectoryChildPath(treePath, directoryTreePath) && !hasRetainedDirectory(treePath, retained)
  removeDirectoryState(model.entriesByTreePath, shouldRemove)
  removeDirectoryState(model.loadedDirectoryPaths, shouldRemove)
  removeDirectoryState(model.loadingDirectoryPaths, shouldRemove)
  removeDirectoryState(model.errorByDirectoryPath, shouldRemove)
}

function removeDirectoryState(
  state: Map<string, unknown> | Set<string>,
  shouldRemove: (treePath: string) => boolean,
) {
  for (const treePath of state.keys()) {
    if (shouldRemove(treePath)) state.delete(treePath)
  }
}

function isDirectoryChildPath(treePath: string, directoryTreePath: string) {
  if (!directoryTreePath) return true

  return treePath.startsWith(`${directoryTreePath}/`)
}

function directoryTreePathForResult(path: string, rootPath: string) {
  if (path === rootPath) return ''

  return canonicalTreePath(toTreePath(path, rootPath))
}

export function cloneTreeModel(model: TreeModel): TreeModel {
  return {
    paths: Array.from(model.paths),
    entriesByTreePath: new Map(model.entriesByTreePath),
    errorByDirectoryPath: new Map(model.errorByDirectoryPath),
    loadedDirectoryPaths: new Set(model.loadedDirectoryPaths),
    loadingDirectoryPaths: new Set(model.loadingDirectoryPaths),
  }
}

function pathsFromEntries(entriesByTreePath: Map<string, TreeEntry>) {
  const paths: string[] = []

  for (const [treePath, entry] of entriesByTreePath) {
    paths.push(isDirectoryEntry(entry) ? `${treePath}/` : treePath)
  }

  return paths
}

function normalizedTreePathMoves(moves: readonly TreePathMove[]) {
  const normalizedMoves: TreePathMove[] = []

  for (const move of moves) {
    const fromTreePath = canonicalTreePath(move.fromTreePath)
    const toTreePath = canonicalTreePath(move.toTreePath)
    if (!fromTreePath) continue
    if (!toTreePath) continue
    if (fromTreePath === toTreePath) continue

    normalizedMoves.push({ fromTreePath, toTreePath })
  }

  return normalizedMoves
}

function moveTreeModelPath(model: TreeModel, rootPath: string, move: TreePathMove): TreeModel {
  if (!model.entriesByTreePath.has(move.fromTreePath)) return model

  const next = cloneTreeModel(model)
  const fromPath = workspacePathForTreePath(rootPath, move.fromTreePath)
  const toPath = workspacePathForTreePath(rootPath, move.toTreePath)

  next.entriesByTreePath = moveTreeEntries(next.entriesByTreePath, move, fromPath, toPath)
  next.loadedDirectoryPaths = moveTreePathSet(next.loadedDirectoryPaths, move)
  next.loadingDirectoryPaths = moveTreePathSet(next.loadingDirectoryPaths, move)
  next.errorByDirectoryPath = moveTreePathMap(next.errorByDirectoryPath, move)
  next.paths = moveTreePathList(next.paths, move)

  return next
}

function moveTreeEntries(
  entries: ReadonlyMap<string, TreeEntry>,
  move: TreePathMove,
  fromPath: string,
  toPath: string,
) {
  const nextEntries = new Map<string, TreeEntry>()

  for (const [treePath, entry] of entries) {
    const nextTreePath = movedTreePath(treePath, move)
    if (!nextTreePath) {
      nextEntries.set(treePath, entry)
      continue
    }

    nextEntries.set(nextTreePath, moveTreeEntry(entry, fromPath, toPath))
  }

  return nextEntries
}

function moveTreePathSet(paths: ReadonlySet<string>, move: TreePathMove) {
  const nextPaths = new Set<string>()

  for (const path of paths) {
    nextPaths.add(movedTreePath(path, move) ?? path)
  }

  return nextPaths
}

function moveTreePathMap<T>(paths: ReadonlyMap<string, T>, move: TreePathMove) {
  const nextPaths = new Map<string, T>()

  for (const [path, value] of paths) {
    nextPaths.set(movedTreePath(path, move) ?? path, value)
  }

  return nextPaths
}

function moveTreePathList(paths: readonly string[], move: TreePathMove) {
  const nextPaths: string[] = []
  const seenPaths = new Set<string>()

  for (const path of paths) {
    const nextPath = movedTreeListPath(path, move)
    if (seenPaths.has(nextPath)) continue

    seenPaths.add(nextPath)
    nextPaths.push(nextPath)
  }

  return nextPaths
}

function movedTreeListPath(path: string, move: TreePathMove) {
  const nextPath = movedTreePath(path, move)
  if (!nextPath) return path
  if (!path.endsWith('/')) return nextPath

  return `${nextPath}/`
}

function movedTreePath(path: string, move: TreePathMove) {
  const treePath = canonicalTreePath(path)
  if (treePath === move.fromTreePath) return move.toTreePath
  if (!treePath.startsWith(`${move.fromTreePath}/`)) return null

  return `${move.toTreePath}${treePath.slice(move.fromTreePath.length)}`
}

function moveTreeEntry(entry: TreeEntry, fromPath: string, toPath: string): TreeEntry {
  const nextPath = filesystemPath(movedWorkspacePath(entry.path, fromPath, toPath))
  const children = entry.children?.map((child) => moveTreeEntry(child, fromPath, toPath))
  if (!children && nextPath === entry.path) return entry
  if (!children) return { ...entry, path: nextPath }

  return { ...entry, children, path: nextPath }
}

function movedWorkspacePath(path: string, fromPath: string, toPath: string) {
  if (path === fromPath) return toPath
  if (!path.startsWith(`${fromPath}/`)) return path

  return `${toPath}${path.slice(fromPath.length)}`
}

function workspacePathForTreePath(rootPath: string, treePath: string) {
  const canonicalRootPath = canonicalTreePath(rootPath)
  const canonicalPath = canonicalTreePath(treePath)
  if (!canonicalRootPath) return canonicalPath
  if (!canonicalPath) return canonicalRootPath

  return `${canonicalRootPath}/${canonicalPath}`
}
