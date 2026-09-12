import { FloppyDiskIcon, TrashIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@workspace/ui/components/dialog'

import { filesystemResource } from '@/lib/documents/utils/capabilities'
import type { TabContent } from '@/lib/documents/utils/types'
import { tabLabel } from '@/lib/documents/utils/labels'
import { Spinner } from '@workspace/ui/components/spinner'
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
      <DialogContent
        data-unsaved-dialog-target={target ? 'true' : undefined}
        className='bg-background w-[min(420px,calc(100vw-2rem))] max-w-none border text-sm sm:max-w-none'
        finalFocus={false}
        ref={dialogFocusTargetRef}
        showCloseButton={false}
      >
        <DialogHeader>
          <DialogTitle>Unsaved changes</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {resource ? (
          <div className='bg-muted/30 text-muted-foreground truncate rounded-lg border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'>
            {resource.path}
          </div>
        ) : null}
        {error ? (
          <div
            className='border-destructive/25 bg-destructive/10 text-destructive flex items-start gap-(--density-control-gap) rounded-lg border px-(--density-control-padding-x) py-(--density-section-gap) text-xs'
            role='alert'
          >
            <WarningCircleIcon className='mt-0.5 size-3.5 shrink-0' />
            <span>{error}</span>
          </div>
        ) : null}
        <DialogFooter>
          <Button disabled={saving} onClick={onCancel} type='button' variant='outline'>
            Cancel
          </Button>
          <Button disabled={saving} onClick={onDiscard} type='button' variant='destructive'>
            <TrashIcon data-icon='inline-start' />
            Discard
          </Button>
          {canSave ? (
            <Button disabled={saving} onClick={onSave} type='button'>
              {saving ? (
                <Spinner aria-hidden='true' data-icon='inline-start' role='presentation' />
              ) : (
                <FloppyDiskIcon data-icon='inline-start' />
              )}
              Save
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
