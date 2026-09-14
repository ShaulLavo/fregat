import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import { Spinner } from '@workspace/ui/components/spinner'
import { TrashIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import { useIsMutating } from '@tanstack/react-query'
import { useProjectActions } from '@/features/chat-mode/hooks/use-project-actions'
import { useProjectDeleteRequestStore } from '@/features/chat-mode/state/project-delete-request-store'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { projectDeletePrompt } from '@/features/chat-mode/utils/project-delete-prompt'

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
    const slice = selectChatProjectionSlice(state, request.ref.environmentId)
    return Object.values(slice.worktreeById).filter(
      (worktree) =>
        worktree.projectId === request.ref.projectId &&
        worktree.ownership === 'platform' &&
        worktree.lifecycle.state !== 'removed',
    ).length
  })

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) actions.cancelDelete()
      }}
      open={request !== null}
    >
      <DialogContent
        className='w-[min(420px,calc(100vw-2rem))] max-w-none border text-sm sm:max-w-none'
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
        {managedCount > 0 ? (
          <p className='text-warning text-sm tabular-nums'>
            Clean up or release the {managedCount} Platform worktrees before deleting this project.
          </p>
        ) : null}
        {error ? (
          <p className='text-destructive text-sm' role='alert'>
            {error}
          </p>
        ) : null}
        <DialogFooter>
          {managedCount > 0 ? (
            <Button
              variant='outline'
              onClick={() => {
                if (!request) return
                useWorktreeManagerStore.getState().openManager(request.ref)
                actions.cancelDelete()
              }}
            >
              Manage worktrees
            </Button>
          ) : null}
          <Button
            disabled={pending}
            onClick={() => actions.cancelDelete()}
            type='button'
            variant='outline'
          >
            Cancel
          </Button>
          <Button
            disabled={managedCount > 0 || pending}
            onClick={() => request && actions.confirmDelete(request)}
            type='button'
            variant='destructive'
          >
            {pending ? <Spinner /> : <TrashIcon data-icon='inline-start' />}
            Delete
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
