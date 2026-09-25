import { gitStatusRows } from '@workspace/client-core/git/status-rows'
import type { GitFileStatus } from '@workspace/contracts'
import type { ChangeRow } from '@/features/git/utils/types'

/**
 * One status entry can produce two rows: a file staged and then edited again
 * shows up under both headings, which is what the panel renders.
 */
export function changeRows(files: readonly GitFileStatus[]) {
  const { staged, worktree } = gitStatusRows(files)

  return {
    staged: staged.map((file): ChangeRow => ({ file, section: 'staged', status: file.index })),
    worktree: worktree.map((file): ChangeRow => ({
      file,
      section: 'worktree',
      status: file.worktree,
    })),
  }
}
