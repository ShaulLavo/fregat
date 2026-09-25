import { Button } from '@workspace/ui/components/button'
import { Spinner } from '@workspace/ui/components/spinner'
import { WarningIcon } from '@phosphor-icons/react'
import { useMutationState, type QueryClient } from '@tanstack/react-query'

import type { FilesystemConflict } from '@/features/editor/state/conflict-state'
import type { ConflictResolutionSource } from '@/features/workspace/utils/conflict-resolution-mutation'
import { workspaceMutationKeys } from '@/features/workspace/utils/mutation-keys'
import { basename, displayPath } from '@/lib/path-formatters'

type FilesystemConflictToastProps = {
  conflict: FilesystemConflict
  onOpenDiff: () => void
  onOverrideLocal: () => void
  onOverrideRemote: () => void
  queryClient: QueryClient
}

/**
 * VS Code's save-conflict notification: the file on disk is newer than the buffer, so compare the
 * two, overwrite the disk with the buffer, or revert the buffer to the disk.
 */
export function FilesystemConflictToast({
  conflict,
  onOpenDiff,
  onOverrideLocal,
  onOverrideRemote,
  queryClient,
}: FilesystemConflictToastProps) {
  const [pending] = useMutationState(
    {
      filters: {
        mutationKey: workspaceMutationKeys.resolveConflict(conflict.id),
        status: 'pending',
      },
      select: (mutation) => mutation.state.variables as ConflictResolutionSource,
    },
    queryClient,
  )
  const busy = pending !== undefined
  return (
    // The Toaster paints the surface; Sonner renders custom toasts inside its title slot.
    <div className='font-normal' role='alertdialog' aria-label={conflictTitle(conflict)}>
      <div className='flex items-start gap-(--density-control-gap)'>
        <WarningIcon className='text-warning mt-0.5 size-(--icon-size) shrink-0' weight='fill' />
        <div className='min-w-0 flex-1'>
          <div className='truncate text-sm font-medium' title={displayPath(conflict.remotePath)}>
            {conflictTitle(conflict)}
          </div>
          <div className='text-muted-foreground mt-1 text-xs leading-5'>
            {conflictDescription(conflict)}
          </div>
        </div>
      </div>
      <div className='mt-(--density-section-gap) flex flex-wrap justify-end gap-(--density-control-gap)'>
        <Button disabled={busy} size='sm' type='button' variant='ghost' onClick={onOverrideRemote}>
          {pending === 'remote' ? <Spinner /> : null}
          Revert
        </Button>
        <Button
          disabled={busy}
          size='sm'
          type='button'
          variant='secondary'
          onClick={onOverrideLocal}
        >
          {pending === 'local' ? <Spinner /> : null}
          Overwrite
        </Button>
        <Button size='sm' type='button' onClick={onOpenDiff}>
          Compare
        </Button>
      </div>
    </div>
  )
}

function conflictTitle(conflict: FilesystemConflict) {
  const name = basename(conflict.localPath)
  if (conflict.eventType === 'deleted') return `${name} was deleted on disk`
  if (conflict.eventType === 'renamed') return `${name} was renamed on disk`
  return `${name} changed on disk`
}

function conflictDescription(conflict: FilesystemConflict) {
  if (conflict.eventType === 'deleted') {
    return 'Your unsaved changes are the only copy. Overwrite recreates the file with them; Revert closes the buffer.'
  }
  if (conflict.eventType === 'renamed') {
    return `It is now ${displayPath(conflict.remotePath)}. Compare your unsaved changes with it, overwrite it with them, or revert to it.`
  }

  return 'Compare your unsaved changes with the file, overwrite the file with them, or revert to what is on disk.'
}
