import { SessionDeleteDialog } from '@/features/chat-mode/components/session-delete-dialog'
import { SessionSnoozeDialog } from '@/features/chat-mode/components/session-snooze-dialog'
import { WorktreeManager } from '@/features/chat-mode/components/worktree-manager'

/**
 * The dialogs a session action can ask for, mounted above both workspace modes so the
 * sidebar chat's menu reaches them too. Delete opens Manage worktrees, so it lives here.
 */
export function SessionDialogs() {
  return (
    <>
      <SessionDeleteDialog />
      <SessionSnoozeDialog />
      <WorktreeManager />
    </>
  )
}
