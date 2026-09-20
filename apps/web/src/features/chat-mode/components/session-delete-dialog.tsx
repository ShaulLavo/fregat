import { useIsMutating } from '@tanstack/react-query'
import { Spinner } from '@workspace/ui/components/spinner'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
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

import { useSessionActions } from '@/features/chat-mode/hooks/use-session-actions'
import { useSessionDeleteRequestStore } from '@/features/chat-mode/state/session-delete-request-store'
import { useWorktreeManagerStore } from '@/features/chat-mode/state/worktree-manager-store'
import {
  selectChatProjectionSlice,
  useChatProjectionStore,
} from '@/features/chat/state/chat-projection-store'
import {
  sessionDeletePrompt,
  sessionDeleteTitle,
} from '@/features/chat-mode/utils/session-delete-prompt'

/**
 * Deleting a session takes its whole event history with it and there is no undo, so it
 * never runs straight off a menu click.
 */
export function SessionDeleteDialog() {
  const request = useSessionDeleteRequestStore((state) => state.request)
  const actions = useSessionActions()
  const pending = useIsMutating({ mutationKey: chatModeMutationKeys.session() }) > 0
  const count = request?.refs.length ?? 1
  const ref = count === 1 ? request?.refs[0] : undefined
  const projection = useChatProjectionStore((state) =>
    ref ? selectChatProjectionSlice(state, ref.environmentId) : null,
  )
  const session = ref ? projection?.sessionById[ref.sessionId] : undefined
  const worktree = session ? projection?.worktreeById[session.worktreeId] : undefined

  return (
    <Dialog onOpenChange={(open) => open || actions.cancelDelete()} open={request !== null}>
      <DialogContent
        className='w-[min(420px,calc(100vw-2rem))] max-w-none text-sm sm:max-w-none'
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>{sessionDeleteTitle(count)}</DialogTitle>
          <DialogDescription>
            {sessionDeletePrompt({ count, title: request?.title ?? 'this session' })}
          </DialogDescription>
        </DialogHeader>
        <p className='text-muted-foreground text-xs'>
          The checkout and its changes stay on disk. Use Manage worktrees for separate cleanup.
        </p>
        {ref && worktree ? (
          <Button
            variant='link'
            className='justify-start px-0'
            onClick={() => {
              actions.cancelDelete()
              useWorktreeManagerStore.getState().openManager({
                environmentId: ref.environmentId,
                projectId: worktree.projectId,
              })
            }}
          >
            Manage worktrees
          </Button>
        ) : null}
        <DialogFooter>
          <Button onClick={() => actions.cancelDelete()} type='button' variant='outline'>
            Cancel
          </Button>
          <Button
            disabled={pending}
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
