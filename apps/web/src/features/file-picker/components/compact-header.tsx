import { ArrowUpIcon, CaretLeftIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import type { ReactNode } from 'react'

import { IconTooltip } from '@/components/icon-tooltip'
import { folderLabel } from '@/features/file-picker/utils/columns'
import { displayPath, pickerParentPath } from '@/features/file-picker/utils/model'

/**
 * The phone picker's bar: Close or Back, the folder over where it lives, then Up and actions.
 * Phones read the leading control as leaving the screen, so it closes until a folder has been
 * opened, then names the folder it returns to. Tapping the name edits the path, which `editor`
 * replaces the name with.
 */
export function CompactHeader({
  actions,
  backPath,
  canGoUp,
  currentPath,
  editor,
  onBack,
  onClose,
  onEditPath,
  onUp,
}: {
  actions: ReactNode
  backPath: string | null
  canGoUp: boolean
  currentPath: string
  editor: ReactNode
  onBack: () => void
  onClose: () => void
  onEditPath: () => void
  onUp: () => void
}) {
  const parent = canGoUp ? displayPath(pickerParentPath(currentPath)) : null

  return (
    <PaneBar className='gap-(--density-gap-tight)'>
      {backPath === null ? (
        <IconTooltip label='Close'>
          <Button aria-label='Close' onClick={onClose} size='icon' type='button' variant='ghost'>
            <XIcon className='size-(--icon-size)' />
          </Button>
        </IconTooltip>
      ) : (
        <Button
          aria-label={`Back to ${folderLabel(backPath)}`}
          className='max-w-28 shrink-0 gap-0.5 px-1'
          onClick={onBack}
          title={displayPath(backPath)}
          type='button'
          variant='ghost'
        >
          <CaretLeftIcon className='size-(--icon-size) shrink-0' />
          <span className='truncate'>{folderLabel(backPath)}</span>
        </Button>
      )}
      {editor ?? (
        <Button
          aria-label={`Go to folder, now ${displayPath(currentPath)}`}
          className='h-auto min-w-0 flex-1 flex-col items-start gap-0 px-1 py-0'
          onClick={onEditPath}
          title={displayPath(currentPath)}
          type='button'
          variant='ghost'
        >
          <span className='w-full truncate text-left text-sm font-semibold'>
            {folderLabel(currentPath)}
          </span>
          {parent ? (
            <span className='text-muted-foreground text-2xs w-full truncate text-left font-normal'>
              {parent}
            </span>
          ) : null}
        </Button>
      )}
      <div className='flex shrink-0 items-center gap-(--density-gap-tight)'>
        <IconTooltip label='Up one folder'>
          <Button
            aria-label='Up one folder'
            disabled={!canGoUp}
            focusableWhenDisabled
            onClick={onUp}
            size='icon'
            type='button'
            variant='ghost'
          >
            <ArrowUpIcon className='size-(--icon-size)' />
          </Button>
        </IconTooltip>
        {actions}
      </div>
    </PaneBar>
  )
}
