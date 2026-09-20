import { TrashIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Dialog } from '@workspace/ui/components/dialog'
import { ActionDialogContent } from '@/components/action-dialog-content'

import type { DeleteTarget } from '@/features/workspace/hooks/use-fs-actions'
import { Spinner } from '@workspace/ui/components/spinner'

/**
 * Deleting is the one tree action with nothing to undo — no trash, no revert —
 * so it never runs straight off a menu click.
 */
export function DeleteEntryDialog({
  deleting,
  error,
  mutationsEnabled,
  onCancel,
  onConfirm,
  target,
}: {
  readonly deleting: boolean
  readonly error: string | null
  readonly mutationsEnabled: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly target: DeleteTarget | null
}) {
  return (
    <Dialog onOpenChange={(open) => open || onCancel()} open={target !== null}>
      <ActionDialogContent
        title={<>Delete {target?.isDirectory ? 'folder' : 'file'}</>}
        description={deleteDescription(target)}
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
          Delete
        </Button>
      </ActionDialogContent>
    </Dialog>
  )
}

function deleteDescription(target: DeleteTarget | null) {
  if (!target) return 'This cannot be undone.'
  if (target.isDirectory) {
    return `Permanently delete ${target.name} and everything inside it? This cannot be undone.`
  }

  return `Permanently delete ${target.name}? This cannot be undone.`
}
