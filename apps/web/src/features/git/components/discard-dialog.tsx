import { ArrowBendUpLeftIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'

import { useDiscardPathsMutation } from '@/features/git/hooks/use-discard-paths-mutation'
import { useDiscardStagedPathsMutation } from '@/features/git/hooks/use-discard-staged-paths-mutation'
import { useGitState } from '@/features/git/state/store'
import { discardPrompt } from '@/features/git/utils/discard-prompt'
import { basename, toTreePath } from '@/lib/path-formatters'

const NO_PATHS: readonly string[] = []

/**
 * Discard restores files from HEAD and deletes untracked ones, with no undo, so every
 * entry point asks here first. One per panel: a dialog inside a row would receive
 * the row's clicks and keys through React's portal bubbling.
 */
export function DiscardDialog({ rootPath }: { rootPath: string }) {
  const request = useGitState((state) => state.discardRequest)
  const close = useGitState((state) => state.closeDiscard)
  const paths = request?.paths ?? NO_PATHS
  const worktree = useDiscardPathsMutation(paths, rootPath)
  const staged = useDiscardStagedPathsMutation(paths, rootPath)
  const discard = request?.section === 'staged' ? staged : worktree
  const pending = discard.isPending
  const prompt = request
    ? discardPrompt(request, basename(toTreePath(paths[0] ?? '', rootPath)))
    : null
  let icon = <ArrowBendUpLeftIcon data-icon='inline-start' />
  if (prompt?.confirm === 'Delete') icon = <TrashIcon data-icon='inline-start' />
  if (pending) icon = <OrbitLoader />

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open && !pending) close()
      }}
      open={request !== null}
    >
      <DialogContent role='alertdialog' showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className='tabular-nums'>{prompt?.title}</DialogTitle>
          <DialogDescription>{prompt?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button disabled={pending} onClick={close} type='button' variant='outline'>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => discard.mutate(undefined, { onSettled: close })}
            type='button'
            variant='destructive'
          >
            {icon}
            {prompt?.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
