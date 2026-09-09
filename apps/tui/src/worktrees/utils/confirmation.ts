import type { WorktreeConfirmation } from '@workspace/client-core/chat/worktrees/commands'

export type CleanupConfirmation = WorktreeConfirmation | { readonly kind: 'safe' }

export function cleanupConfirmationText(confirmation: CleanupConfirmation) {
  switch (confirmation.kind) {
    case 'safe':
      return {
        title: 'Clean up worktree',
        description:
          'Remove this checkout only if it has no changes or running processes. Keep its branch and commits.',
        action: 'Clean up',
      }
    case 'force':
      return {
        title: 'Discard changes and remove',
        description: `Permanently discard ${confirmation.preview.changedFileCount} changed files, including tracked, untracked, and ignored files in this checkout. Keep its branch and commits. Further edits require a new confirmation.`,
        action: 'Discard changes and remove',
      }
    case 'missing':
      return {
        title: 'Confirm checkout is absent',
        description:
          'Resolve this absent checkout. No files will be deleted. Its branch and commits may still exist.',
        action: 'Confirm checkout is absent',
      }
    case 'release':
      return {
        title: 'Release worktree',
        description:
          'Keep this checkout and its branch on disk. Platform gives up cleanup ownership. Any later cleanup must be done manually.',
        action: 'Release worktree',
      }
  }
}
