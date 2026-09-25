import { isStagedStatus, isWorktreeStatus, type GitFileStatus } from '@workspace/contracts'

export type GitStatusRows = {
  staged: readonly GitFileStatus[]
  worktree: readonly GitFileStatus[]
}

/**
 * Partitions status entries into staged and worktree rows, sorted by path.
 * `'ignored'` is excluded from both sections, so a future `--ignored` route
 * cannot silently push ignored files into the change list.
 */
export function gitStatusRows(files: readonly GitFileStatus[]): GitStatusRows {
  const staged: GitFileStatus[] = []
  const worktree: GitFileStatus[] = []

  for (const file of files.toSorted(compareStatusPaths)) {
    if (file.index !== 'ignored' && isStagedStatus(file.index)) staged.push(file)
    if (file.worktree !== 'ignored' && isWorktreeStatus(file.worktree)) worktree.push(file)
  }

  return { staged, worktree }
}

function compareStatusPaths(left: GitFileStatus, right: GitFileStatus) {
  if (left.path < right.path) return -1
  if (left.path > right.path) return 1

  return 0
}
