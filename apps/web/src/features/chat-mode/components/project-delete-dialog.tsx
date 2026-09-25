import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import { useIsMutating } from '@tanstack/react-query'
import { useProjectActions } from '@/features/chat-mode/hooks/use-project-actions'
import { useProjectDeleteRequestStore } from '@/features/chat-mode/state/project-delete-request-store'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { projectDeletePrompt } from '@/features/chat-mode/utils/project-delete-prompt'
import { DeleteDialogFooter } from '@workspace/ui/patterns/delete-dialog-footer'
import { InlineError } from '@/components/inline-error'

/**
 * Deleting a project cascades onto every session it owns and there is no undo,
 * so it never runs straight off a menu click.
 */
export function ProjectDeleteDialog() {
  const request = useProjectDeleteRequestStore((state) => state.request)
  const pending = useIsMutating({ mutationKey: chatModeMutationKeys.projectDelete() }) > 0
  const error = useProjectDeleteRequestStore((state) => state.error)
  const actions = useProjectActions()
  const managedCount = useChatProjectionStore((state) => {
    if (!request) return 0
    return request.members.reduce((count, member) => {
      const slice = selectChatProjectionSlice(state, member.ref.environmentId)
      return (
        count +
        Object.values(slice.worktreeById).filter(
          (worktree) =>
            worktree.projectId === member.ref.projectId &&
            worktree.ownership === 'platform' &&
            worktree.lifecycle.state !== 'removed',
        ).length
      )
    }, 0)
  })

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) actions.cancelDelete()
      }}
      open={request !== null}
    >
      <DialogContent
        className='w-[min(420px,calc(100vw-2rem))] max-w-none text-sm sm:max-w-none'
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Delete project</DialogTitle>
          <DialogDescription>
            {projectDeletePrompt({
              sessionCount: request?.sessionCount ?? 0,
              title: request?.title ?? 'this project',
            })}
          </DialogDescription>
        </DialogHeader>
        <ul className='space-y-1 text-xs'>
          {request?.members.map((member) => (
            <li key={member.physicalKey} title={`${member.label}: ${member.workspaceRoot}`}>
              {member.label} · {member.workspaceRoot} · {member.sessionCount} sessions
              {member.available ? '' : ' · Unavailable'}
            </li>
          ))}
        </ul>
        {managedCount > 0 ? (
          <p className='text-warning text-sm tabular-nums'>
            Clean up or release the {managedCount} Platform worktrees before deleting this project.
          </p>
        ) : null}
        {error ? (
          <InlineError
            message={error}
            onHandOff={() => actions.cancelDelete()}
            title='Project delete'
          />
        ) : null}
        <DeleteDialogFooter
          cancelDisabled={pending}
          confirmDisabled={managedCount > 0 || request?.members.some((member) => !member.available)}
          onCancel={() => actions.cancelDelete()}
          onConfirm={() => request && actions.confirmDelete(request)}
          pending={pending}
        >
          {managedCount > 0
            ? request?.members.map((member) => (
                <Button
                  key={member.physicalKey}
                  variant='outline'
                  onClick={() => {
                    useWorktreeManagerStore.getState().openManager(member.ref)
                    actions.cancelDelete()
                  }}
                >
                  {request.members.length > 1
                    ? `Manage worktrees (${member.label})`
                    : 'Manage worktrees'}
                </Button>
              ))
            : null}
        </DeleteDialogFooter>
      </DialogContent>
    </Dialog>
  )
}
