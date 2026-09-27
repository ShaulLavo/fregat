import { CaretLeftIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import { PaneBar } from '@workspace/ui/components/pane-bar'
import type { ReactNode } from 'react'

import { IconTooltip } from '@/components/icon-tooltip'
import { folderLabel } from '@/features/file-picker/utils/columns'
import { displayPath, pickerParentPath } from '@/features/file-picker/utils/model'

/**
 * The phone picker's bar, shaped like the phone shell's: Up, the folder over where it lives, then
 * actions. Tapping the name edits the path, which `editor` replaces the name with.
 */
export function CompactHeader({
  actions,
  canGoUp,
  currentPath,
  editor,
  onEditPath,
  onUp,
}: {
  actions: ReactNode
  canGoUp: boolean
  currentPath: string
  editor: ReactNode
  onEditPath: () => void
  onUp: () => void
}) {
  const parent = canGoUp ? displayPath(pickerParentPath(currentPath)) : null

  return (
    <PaneBar className='gap-(--density-gap-tight)'>
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
          <CaretLeftIcon className='size-(--icon-size)' />
        </Button>
      </IconTooltip>
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
      <div className='flex shrink-0 items-center gap-(--density-gap-tight)'>{actions}</div>
    </PaneBar>
  )
}
