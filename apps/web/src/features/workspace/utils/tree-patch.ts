import { cloneTreeModel as cloneModel } from '@/lib/tree-model'
import { filesystemPath } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import type { TreeEntry } from '@/lib/file-system-types'
import { isDirectoryEntry } from '@/lib/file-system-types'
import { canonicalTreePath } from '@/lib/path-formatters'
import { moveTreeModelPaths, type TreeModel, type TreePathMove } from '@/lib/tree-model'

import {
  containerContentsLoaded,
  containerTreePath,
  entryName,
  workspacePathForTreePath,
} from '@/features/workspace/utils/entry-paths'

/** One filesystem change the tree shows before the server confirms it. Paths are tree paths. */
export type TreePatch =
  | {
      readonly kind: 'create'
      readonly rootPath: FilesystemPath
      readonly treePath: string
      readonly isFolder: boolean
    }
  | {
      readonly kind: 'move'
      readonly rootPath: FilesystemPath
      readonly moves: readonly TreePathMove[]
    }
  | {
      readonly kind: 'duplicate'
      readonly rootPath: FilesystemPath
      readonly from: string
      readonly to: string
      readonly isFolder: boolean
    }
  | { readonly kind: 'delete'; readonly rootPath: FilesystemPath; readonly treePath: string }

/** The model the server will hand back once the change has landed. */
export function applyTreePatch(model: TreeModel, patch: TreePatch): TreeModel {
  switch (patch.kind) {
    case 'create':
      return withEntry(model, patch.rootPath, patch.treePath, patch.isFolder ? 'directory' : 'file')
    case 'move':
      return moveTreeModelPaths(model, patch.rootPath, patch.moves)
    case 'duplicate':
      return withCopiedEntries(model, patch)
    case 'delete':
      return withoutEntry(model, patch.treePath)
  }
}

/** Resource keys for supersession: every tree path the patch touches, scoped to its root. */
export function treePatchResources(patch: TreePatch): string[] {
  const paths = treePatchPaths(patch)
  return paths.map((treePath) => `${patch.rootPath}:${canonicalTreePath(treePath)}`)
}

export function treePatchPaths(patch: TreePatch): string[] {
  switch (patch.kind) {
    case 'create':
    case 'delete':
      return [patch.treePath]
    case 'move':
      return patch.moves.flatMap((move) => [move.fromTreePath, move.toTreePath])
    case 'duplicate':
      return [patch.from, patch.to]
  }
}

/**
 * Whether the confirmed model already shows the change. A destination inside a
 * directory the model has not loaded counts as settled: the server cannot list
 * it until that directory is expanded, and holding the intent would only time
 * it out.
 */
export function treePatchConfirmed(model: TreeModel, patch: TreePatch): boolean {
  switch (patch.kind) {
    case 'create':
      return destinationSettled(model, patch.treePath)
    case 'move':
      return patch.moves.every(
        (move) => !hasEntry(model, move.fromTreePath) && destinationSettled(model, move.toTreePath),
      )
    case 'duplicate':
      return destinationSettled(model, patch.to)
    case 'delete':
      return !hasEntry(model, patch.treePath)
  }
}

function destinationSettled(model: TreeModel, treePath: string) {
  if (hasEntry(model, treePath)) return true
  const container = containerTreePath(treePath, false)
  return !containerContentsLoaded(model.loadedDirectoryPaths, container)
}

function hasEntry(model: TreeModel, treePath: string) {
  return model.entriesByTreePath.has(canonicalTreePath(treePath))
}

function withEntry(
  model: TreeModel,
  rootPath: FilesystemPath,
  treePath: string,
  type: 'directory' | 'file',
): TreeModel {
  const canonicalPath = canonicalTreePath(treePath)
  if (model.entriesByTreePath.has(canonicalPath)) return model

  const next = cloneModel(model)
  next.entriesByTreePath.set(canonicalPath, syntheticEntry(rootPath, canonicalPath, type))
  next.paths.push(type === 'directory' ? `${canonicalPath}/` : canonicalPath)
  // An empty new folder has nothing to fetch, and a create inside it must not wait on a load.
  if (type === 'directory') next.loadedDirectoryPaths.add(canonicalPath)
  return next
}

function withCopiedEntries(
  model: TreeModel,
  patch: Extract<TreePatch, { kind: 'duplicate' }>,
): TreeModel {
  const from = canonicalTreePath(patch.from)
  const to = canonicalTreePath(patch.to)
  const source = model.entriesByTreePath.get(from)
  if (!source) return model
  if (model.entriesByTreePath.has(to)) return model

  const next = cloneModel(model)
  for (const [treePath, entry] of model.entriesByTreePath) {
    const copiedPath = copiedTreePath(treePath, from, to)
    if (!copiedPath) continue

    next.entriesByTreePath.set(copiedPath, copiedEntry(entry, patch.rootPath, copiedPath))
    next.paths.push(isDirectoryEntry(entry) ? `${copiedPath}/` : copiedPath)
    if (model.loadedDirectoryPaths.has(treePath)) next.loadedDirectoryPaths.add(copiedPath)
  }
  return next
}

function withoutEntry(model: TreeModel, treePath: string): TreeModel {
  const canonicalPath = canonicalTreePath(treePath)
  if (!model.entriesByTreePath.has(canonicalPath)) return model

  const next = cloneModel(model)
  for (const path of model.entriesByTreePath.keys()) {
    if (!isSelfOrChild(path, canonicalPath)) continue

    next.entriesByTreePath.delete(path)
    next.loadedDirectoryPaths.delete(path)
    next.loadingDirectoryPaths.delete(path)
    next.errorByDirectoryPath.delete(path)
  }
  next.paths = next.paths.filter((path) => !isSelfOrChild(canonicalTreePath(path), canonicalPath))
  return next
}

function copiedTreePath(treePath: string, from: string, to: string) {
  if (treePath === from) return to
  if (!treePath.startsWith(`${from}/`)) return null

  return `${to}${treePath.slice(from.length)}`
}

function copiedEntry(entry: TreeEntry, rootPath: FilesystemPath, treePath: string): TreeEntry {
  const { canonicalPath: _canonicalPath, children: _children, ...rest } = entry
  return {
    ...rest,
    name: entryName(treePath),
    path: workspacePathForTreePath(rootPath, treePath),
  }
}

function syntheticEntry(
  rootPath: FilesystemPath,
  treePath: string,
  type: 'directory' | 'file',
): TreeEntry {
  const now = Date.now()
  return {
    birthtimeMs: now,
    mtimeMs: now,
    name: entryName(treePath),
    path: filesystemPath(workspacePathForTreePath(rootPath, treePath)),
    size: 0,
    type,
    version: '',
  }
}

function isSelfOrChild(path: string, directoryPath: string) {
  return path === directoryPath || path.startsWith(`${directoryPath}/`)
}
