import type { GitFileStatus, GitTreeStatus } from '@workspace/contracts'
import type { GitStatusEntry } from '@workspace/tree'

import { toTreePath } from '@/lib/path-formatters'

export function statusEntriesForTree(
  files: readonly GitFileStatus[],
  rootPath: string,
): GitStatusEntry[] {
  const entries: GitStatusEntry[] = []

  for (const file of files) {
    const treePath = treePathForStatus(file.path, rootPath)
    const status = fileTreeStatus(file.status)
    if (!treePath || !status) continue

    entries.push({ path: treePath, status })
  }

  return entries
}

function treePathForStatus(path: string, rootPath: string) {
  if (path === rootPath) return ''
  if (!path.startsWith(`${rootPath}/`)) return null

  return toTreePath(path, rootPath)
}

function fileTreeStatus(status: GitTreeStatus | 'conflicted'): GitStatusEntry['status'] | null {
  if (status === 'conflicted') return 'modified'

  return status
}
