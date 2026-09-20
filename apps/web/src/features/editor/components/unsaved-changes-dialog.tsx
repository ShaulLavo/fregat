import { FloppyDiskIcon, TrashIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { Dialog } from '@workspace/ui/components/dialog'
import { ActionDialogContent } from '@/components/action-dialog-content'

import { filesystemResource } from '@/lib/documents/utils/capabilities'
import type { TabContent } from '@/lib/documents/utils/types'
import { tabLabel } from '@/lib/documents/utils/labels'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import type { UnsavedDialogTarget } from '@/features/editor/hooks/use-dirty-tab-close'
import { useFocusTarget } from '@/lib/focus/hooks/use-target'

const CLOSED_DIALOG_TARGET = Object.freeze({})

type UnsavedChangesDialogProps = {
  canSave: boolean
  error: string | null
  open: boolean
  content: TabContent | null
  saving: boolean
  target: UnsavedDialogTarget | null
  onCancel: () => void
  onDiscard: () => void
  onOpenChange: (open: boolean) => void
  onSave: () => void
}

export function UnsavedChangesDialog({
  canSave,
  error,
  open,
  content,
  saving,
  target,
  onCancel,
  onDiscard,
  onOpenChange,
  onSave,
}: UnsavedChangesDialogProps) {
  const name = content ? tabLabel(content) : 'this tab'
  const resource = content?.kind === 'document' ? filesystemResource(content.document) : null
  const description = canSave
    ? `Save changes to ${name} before closing?`
    : `${name} has unsaved changes that cannot be saved directly.`
  const { ref: dialogFocusTargetRef } = useFocusTarget<HTMLDivElement>({
    area: 'dialog',
    capabilities: { overlay: true },
    id: { dialogTarget: target ?? CLOSED_DIALOG_TARGET, kind: 'unsaved-dialog' },
    onIntent: (intent, element) => {
      if (intent !== 'focus') return false
      if (!open || !target) return false

      element.focus()
      return true
    },
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <ActionDialogContent
        title='Unsaved changes'
        description={description}
        path={resource?.path}
        error={error}
        pending={saving}
        onCancel={onCancel}
        data-unsaved-dialog-target={target ? 'true' : undefined}
        className='bg-background'
        finalFocus={false}
        ref={dialogFocusTargetRef}
      >
        <Button disabled={saving} onClick={onDiscard} type='button' variant='destructive'>
          <TrashIcon data-icon='inline-start' />
          Discard
        </Button>
        {canSave ? (
          <Button disabled={saving} onClick={onSave} type='button'>
            {saving ? (
              <OrbitLoader aria-hidden='true' data-icon='inline-start' role='presentation' />
            ) : (
              <FloppyDiskIcon data-icon='inline-start' />
            )}
            Save
          </Button>
        ) : null}
      </ActionDialogContent>
    </Dialog>
  )
}
