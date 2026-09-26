import { useIsMutating } from '@tanstack/react-query'
import { useState } from 'react'
import { chatModeMutationKeys } from '@/features/chat-mode/utils/mutation-keys'
import { primaryQueryClient } from '@/lib/environments/state/query-clients'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { DeleteDialogFooter } from '@workspace/ui/patterns/delete-dialog-footer'
import { SessionDeleteWorktreeOption } from '@/features/chat-mode/components/session-delete-worktree-option'
import { worktreeRemovalChoice } from '@/features/chat-mode/utils/worktree-removal-choice'
import { useSettingValue } from '@/hooks/use-setting-value'

/**
 * Deleting a session takes its whole event history with it and there is no undo, so it
 * never runs straight off a menu click.
 */
export function SessionDeleteDialog() {
  const request = useSessionDeleteRequestStore((state) => state.request)
  const actions = useSessionActions()
  const pending =
    useIsMutating({ mutationKey: chatModeMutationKeys.session() }, primaryQueryClient()) > 0
  const count = request?.refs.length ?? 1
  const ref = count === 1 ? request?.refs[0] : undefined
  const projection = useChatProjectionStore((state) =>
    ref ? selectChatProjectionSlice(state, ref.environmentId) : null,
  )
  const session = ref ? projection?.sessionById[ref.sessionId] : undefined
  const worktree = session ? projection?.worktreeById[session.worktreeId] : undefined
  const cleanupOnDelete = useSettingValue('git.worktreeCleanupOnDelete')
  const projectCleanup = useSettingValue('git.projectWorktreeCleanupOnDelete')
  const choice = worktreeRemovalChoice(
    worktree,
    (worktree ? projectCleanup[worktree.projectId] : undefined) ?? cleanupOnDelete,
  )
  const [removeWorktree, setRemoveWorktree] = useState(false)
  const close = () => {
    setRemoveWorktree(false)
    actions.cancelDelete()
  }

  return (
    <Dialog onOpenChange={(open) => open || close()} open={request !== null}>
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
        <SessionDeleteWorktreeOption
          choice={ref ? choice : 'kept'}
          checked={removeWorktree}
          onCheckedChange={setRemoveWorktree}
        />
        {ref && worktree ? (
          <Button
            variant='link'
            className='justify-start px-0'
            onClick={() => {
              close()
              useWorktreeManagerStore.getState().openManager({
                environmentId: ref.environmentId,
                projectId: worktree.projectId,
              })
            }}
          >
            Manage worktrees
          </Button>
        ) : null}
        <DeleteDialogFooter
          hold
          onCancel={close}
          onConfirm={() => {
            if (!request) return
            setRemoveWorktree(false)
            void actions.confirmDelete(request, {
              removeWorktree: choice === 'offer' && removeWorktree,
            })
          }}
          pending={pending}
        />
      </DialogContent>
    </Dialog>
  )
}
