import { isWorktreeStatus } from '@/lib/git-status'
import { isStagedStatus } from '@/lib/git-status'
import type { GitFileStatus } from '@workspace/contracts'
import type { ChangeRow } from '@/features/git/utils/types'

/**
 * One status entry can produce two rows: a file staged and then edited again
 * shows up under both headings, which is what the panel renders.
 */
export function changeRows(files: readonly GitFileStatus[]) {
  const staged: ChangeRow[] = []
  const worktree: ChangeRow[] = []

  for (const file of sortedStatusFiles(files)) {
    if (isStagedStatus(file.index)) {
      staged.push({ file, section: 'staged', status: file.index })
    }
    if (isWorktreeStatus(file.worktree)) {
      worktree.push({ file, section: 'worktree', status: file.worktree })
    }
  }

  return { staged, worktree }
}

/**
 * An untracked file reports `index: 'untracked'` rather than `'unmodified'`,
 * so a bare inequality would count it as staged. Exported because the file
 * tree's row menu decides stage-vs-unstage from the same rule — two copies
 * would eventually disagree with the panel.
 */

function sortedStatusFiles(files: readonly GitFileStatus[]) {
  return files.toSorted(compareStatusPaths)
}

function compareStatusPaths(left: GitFileStatus, right: GitFileStatus) {
  if (left.path < right.path) return -1
  if (left.path > right.path) return 1

  return 0
}
