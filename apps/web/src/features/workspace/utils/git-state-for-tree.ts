import type { FileTreeGitState, GitStatusCode } from '@shaulavo/workbench-core'
import { ancestorsOf } from '@shaulavo/workbench-tree'

import type { TreeGitStatusEntry } from '@/features/git/utils/status-entries-for-tree'
import { canonicalTreePath } from '@/lib/path-formatters'

export function fileTreeGitState(entries: readonly TreeGitStatusEntry[]): FileTreeGitState {
  const statusByPath = new Map<string, GitStatusCode>()
  const directoriesWithChanges = new Set<string>()
  const ignoredDirectories = new Set<string>()

  for (const entry of entries) {
    const path = canonicalTreePath(entry.path)
    if (!path) continue
    statusByPath.set(path, entry.status)

    if (entry.status === 'ignored') {
      if (entry.path.endsWith('/')) ignoredDirectories.add(path)
      continue
    }

    for (const ancestor of ancestorsOf(path)) {
      directoriesWithChanges.add(ancestor)
    }
  }

  return {
    directoriesWithChanges,
    ignoredDirectories,
    statusByPath,
  }
}
