import type { GitStatusCode } from '@shaulavo/workbench-core'
import type { GitFileStatus, GitTreeStatus } from '@workspace/contracts'

import { toTreePath } from '@/lib/path-formatters'

export type TreeGitStatusEntry = {
  readonly path: string
  readonly status: Exclude<GitStatusCode, 'conflict'>
}

export function statusEntriesForTree(
  files: readonly GitFileStatus[],
  rootPath: string,
): TreeGitStatusEntry[] {
  const entries: TreeGitStatusEntry[] = []

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

function fileTreeStatus(status: GitTreeStatus | 'conflicted'): TreeGitStatusEntry['status'] | null {
  if (status === 'conflicted') return 'modified'

  return status
}
