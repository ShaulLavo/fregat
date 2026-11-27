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
  targets,
}: {
  readonly deleting: boolean
  readonly error: string | null
  readonly mutationsEnabled: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly permanent: boolean
  readonly targets: readonly DeleteTarget[]
}) {
  const single = targets.length === 1 ? (targets[0] ?? null) : null
  const title = single
    ? `Delete ${single.isDirectory ? 'folder' : 'file'}`
    : `Delete ${targets.length} items`

  return (
    <Dialog onOpenChange={(open) => open || onCancel()} open={targets.length > 0}>
      <ActionDialogContent
        title={title}
        description={deleteDescription(targets, permanent)}
        path={single?.path}
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

function deleteDescription(targets: readonly DeleteTarget[], permanent: boolean) {
  if (targets.length === 0) return ''
  if (targets.length > 1) {
    if (permanent) {
      return `${targets.length} selected items are too large to keep for undo. Delete them permanently? This cannot be undone.`
    }
    return `Delete ${targets.length} selected items? Ctrl+Z in the file tree brings them back.`
  }
  const target = targets[0]
  if (!target) return ''
  const subject = target.isDirectory ? `${target.name} and everything inside it` : target.name
  if (permanent) {
    return `${subject} is too large to keep for undo. Delete it permanently? This cannot be undone.`
  }

  return `Delete ${subject}? Ctrl+Z in the file tree brings it back.`
}
