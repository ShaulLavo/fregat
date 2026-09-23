import { filesystemPath } from '@/lib/documents/utils/identity'
import type { WorkspaceEditResultEntry } from '@workspace/contracts'

import type { TreeEntry } from '@/lib/file-system-types'
import { basename, canonicalTreePath, toTreePath } from '@/lib/path-formatters'
import { moveTreeModelPaths, type TreeModel } from '@/lib/tree-model'

export type WorkspaceEditTreeRename = {
  readonly from: string
  readonly to: string
}

export function projectWorkspaceEditTree(
  model: TreeModel,
  rootPath: string,
  entries: readonly WorkspaceEditResultEntry[],
  renames: readonly WorkspaceEditTreeRename[],
): TreeModel {
  const moved = moveTreeModelPaths(
    model,
    rootPath,
    renames.map((rename) => ({
      fromTreePath: toTreePath(rename.from, rootPath),
      toTreePath: toTreePath(rename.to, rootPath),
    })),
  )
  const next = cloneTreeModel(moved)

  for (const entry of entries) {
    if (!entry.exists) {
      removeTreePath(next, rootPath, entry.path)
      continue
    }
    installTreeEntry(next, rootPath, entry)
  }
  next.paths = treePaths(next.entriesByTreePath)
  return next
}

function installTreeEntry(
  model: TreeModel,
  rootPath: string,
  entry: Extract<WorkspaceEditResultEntry, { readonly exists: true }>,
): void {
  const treePath = canonicalTreePath(toTreePath(entry.path, rootPath))
  if (!treePath) return
  const current = model.entriesByTreePath.get(treePath)
  if (!current && !isVisibleTreeParent(model, treePath)) return
  model.entriesByTreePath.set(treePath, treeEntry(entry, current))
}

function treeEntry(
  entry: Extract<WorkspaceEditResultEntry, { readonly exists: true }>,
  current: TreeEntry | undefined,
): TreeEntry {
  const contents =
    entry.type === 'file'
      ? { size: entry.size, version: entry.version }
      : { size: current?.size ?? 0, version: current?.version ?? '' }
  return {
    birthtimeMs: current?.birthtimeMs ?? entry.mtimeMs,
    ...(current?.children ? { children: current.children } : {}),
    mtimeMs: entry.mtimeMs,
    name: basename(entry.path),
    path: filesystemPath(entry.path),
    type: entry.type,
    ...contents,
  }
}

function isVisibleTreeParent(model: TreeModel, treePath: string): boolean {
  const separator = treePath.lastIndexOf('/')
  if (separator < 0) return true
  const parent = treePath.slice(0, separator)
  return model.entriesByTreePath.has(parent)
}

function removeTreePath(model: TreeModel, rootPath: string, path: string): void {
  const treePath = canonicalTreePath(toTreePath(path, rootPath))
  if (!treePath) return
  for (const candidate of Array.from(model.entriesByTreePath.keys())) {
    if (candidate !== treePath && !candidate.startsWith(`${treePath}/`)) continue
    model.entriesByTreePath.delete(candidate)
    model.loadedDirectoryPaths.delete(candidate)
    model.loadingDirectoryPaths.delete(candidate)
    model.errorByDirectoryPath.delete(candidate)
  }
}

function cloneTreeModel(model: TreeModel): TreeModel {
  return {
    entriesByTreePath: new Map(model.entriesByTreePath),
    errorByDirectoryPath: new Map(model.errorByDirectoryPath),
    loadedDirectoryPaths: new Set(model.loadedDirectoryPaths),
    loadingDirectoryPaths: new Set(model.loadingDirectoryPaths),
    paths: [...model.paths],
  }
}

function treePaths(entries: ReadonlyMap<string, TreeEntry>): string[] {
  const paths: string[] = []
  for (const [treePath, entry] of entries) {
    paths.push(entry.type === 'directory' ? `${treePath}/` : treePath)
  }
  return paths
}
