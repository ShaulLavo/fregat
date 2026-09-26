import { PushPinIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { IconTooltip } from '@/components/icon-tooltip'
import { usePickerLocationActions } from '@/features/file-picker/hooks/use-picker-location-actions'

/** Pins the open folder to the sidebar, or unpins it. */
export function PinFolderButton({ currentPath }: { currentPath: string }) {
  const actions = usePickerLocationActions()
  const pinned = actions.pinned.includes(currentPath)
  const label = pinned ? 'Unpin this folder' : 'Pin this folder'

  return (
    <IconTooltip label={label}>
      <Button
        aria-label={label}
        aria-pressed={pinned}
        onClick={() => (pinned ? actions.unpin(currentPath) : actions.pin(currentPath))}
        size='icon-sm'
        type='button'
        variant='ghost'
      >
        {pinned ? <PushPinIcon weight='fill' /> : <PushPinIcon weight='regular' />}
      </Button>
    </IconTooltip>
  )
}
