import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'

import type { FsMetadataStore } from './metadata'
import type { WorkspacePaths } from './path'

export type ProjectFolder = { label: string; path: string; repoCount: number }

const PICKED_SCAN_LIMIT = 200
const PARENTS_MEASURED = 12
const PROJECT_FOLDER_LIMIT = 6
// A parent with thousands of children is a dump, not a projects folder; stop counting there.
const CHILD_SCAN_LIMIT = 1000

/**
 * Folders that hold the projects this machine opens: parents of opened workspaces and picked
 * folders, kept when they hold two or more git checkouts or two opened ones. `covered` paths
 * (home, places, drives) already have a row.
 */
export async function readProjectFolders(
  paths: WorkspacePaths,
  metadata: FsMetadataStore,
  covered: ReadonlySet<string>,
): Promise<ProjectFolder[]> {
  const opened = openedByParent(paths, metadata)
  const parents = [...opened]
    .filter(([parent]) => !covered.has(parent))
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, PARENTS_MEASURED)
  const measured = await Promise.all(
    parents.map(async ([parent, children]) => ({
      path: parent,
      openedCount: children.size,
      repoCount: await countRepositories(paths.resolve(parent).absolutePath),
    })),
  )
  const kept = measured
    .filter((folder): folder is typeof folder & { repoCount: number } => folder.repoCount !== null)
    .filter((folder) => folder.repoCount >= 2 || folder.openedCount >= 2)
    .sort((a, b) => b.openedCount - a.openedCount || b.repoCount - a.repoCount)
    .slice(0, PROJECT_FOLDER_LIMIT)
  return kept.map((folder) => ({
    label: distinctLabel(folder.path, kept),
    path: folder.path,
    repoCount: folder.repoCount,
  }))
}

function openedByParent(paths: WorkspacePaths, metadata: FsMetadataStore) {
  const workspaces = metadata
    .listWorkspaceAddressPaths(paths.workspaceRootReal)
    .flatMap((absolute) => realRelative(paths, absolute))
  const byParent = new Map<string, Set<string>>()
  for (const folder of [...metadata.listPickedDirectories(PICKED_SCAN_LIMIT), ...workspaces]) {
    if (folder === '') continue
    const parent = path.posix.dirname(folder)
    const key = parent === '.' ? '' : parent
    if (key === '') continue
    const children = byParent.get(key) ?? new Set<string>()
    children.add(folder)
    byParent.set(key, children)
  }
  return byParent
}

function realRelative(paths: WorkspacePaths, absolute: string) {
  try {
    return [paths.toRealRelative(absolute)]
  } catch {
    return []
  }
}

// Null when the folder is gone or unreadable: its stored picks and workspaces outlive it.
async function countRepositories(absolute: string) {
  const entries = await readdir(absolute, { withFileTypes: true }).catch(() => null)
  if (!entries) return null
  const folders = entries
    .slice(0, CHILD_SCAN_LIMIT)
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
  // A worktree's `.git` is a file, a clone's a directory; both count.
  const checks = await Promise.all(
    folders.map((entry) =>
      stat(path.join(absolute, entry.name, '.git')).then(
        () => true,
        () => false,
      ),
    ),
  )
  return checks.filter(Boolean).length
}

/** The basename, or the last two segments when two kept folders share one. */
function distinctLabel(folder: string, kept: readonly { path: string }[]) {
  const name = path.posix.basename(folder)
  const shared = kept.some(
    (other) => other.path !== folder && path.posix.basename(other.path) === name,
  )
  if (!shared) return name
  return folder.split('/').slice(-2).join('/')
}
