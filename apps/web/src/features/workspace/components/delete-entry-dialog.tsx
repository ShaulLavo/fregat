import { TrashIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Dialog } from '@workspace/ui/components/dialog'
import { ActionDialogContent } from '@/components/action-dialog-content'

import type { DeleteTarget } from '@/features/workspace/hooks/use-fs-actions'
import { Spinner } from '@workspace/ui/components/spinner'

/**
 * A delete is journaled, so Ctrl+Z in the tree brings it back. The one exception is a delete
 * too large for the undo journal, and the dialog says so before anything is removed.
 */
export function DeleteEntryDialog({
  deleting,
  error,
  mutationsEnabled,
  onCancel,
  onConfirm,
  permanent,
  target,
}: {
  readonly deleting: boolean
  readonly error: string | null
  readonly mutationsEnabled: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly permanent: boolean
  readonly target: DeleteTarget | null
}) {
  return (
    <Dialog onOpenChange={(open) => open || onCancel()} open={target !== null}>
      <ActionDialogContent
        title={<>Delete {target?.isDirectory ? 'folder' : 'file'}</>}
        description={deleteDescription(target, permanent)}
        path={target?.path}
        error={error}
        pending={deleting}
        onCancel={onCancel}
      >
        <Button
          disabled={deleting || !mutationsEnabled}
          onClick={onConfirm}
          type='button'
          variant='destructive'
        >
          {deleting ? (
            <Spinner aria-hidden='true' data-icon='inline-start' role='presentation' />
          ) : (
            <TrashIcon data-icon='inline-start' />
          )}
          {permanent ? 'Delete permanently' : 'Delete'}
        </Button>
      </ActionDialogContent>
    </Dialog>
  )
}

function deleteDescription(target: DeleteTarget | null, permanent: boolean) {
  if (!target) return ''
  const subject = target.isDirectory ? `${target.name} and everything inside it` : target.name
  if (permanent) {
    return `${subject} is too large to keep for undo. Delete it permanently? This cannot be undone.`
  }

  return `Delete ${subject}? Ctrl+Z in the file tree brings it back.`
}
