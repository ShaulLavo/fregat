import type { WorktreeConfirmation } from './commands'

export type CleanupConfirmation = WorktreeConfirmation | { readonly kind: 'safe' }

export function cleanupConfirmationText(
  confirmation: CleanupConfirmation,
  label = 'this worktree',
) {
  switch (confirmation.kind) {
    case 'safe':
      return {
        title: 'Remove worktree',
        description: `Remove ${label} if it has no changes and nothing runs in it. Its branch and commits stay.`,
        action: 'Remove worktree',
      }
    case 'force':
      return {
        title: 'Delete changes and remove worktree',
        description: `Delete ${confirmation.preview.changedFileCount} changed files in ${label}, including untracked and ignored files, then remove it. This cannot be undone. Its branch and commits stay. If the files change again, you are asked again.`,
        action: 'Delete changes and remove',
      }
    case 'missing':
      return {
        title: 'Forget missing worktree',
        description: `${label} is no longer on disk. Fregat stops tracking it and deletes no files. Its branch and commits may still exist.`,
        action: 'Forget missing worktree',
      }
    case 'release':
      return {
        title: 'Stop managing worktree',
        description: `${label} and its branch stay on disk. Fregat stops managing it and never removes it, so remove it yourself when you are done.`,
        action: 'Stop managing worktree',
      }
  }
}
