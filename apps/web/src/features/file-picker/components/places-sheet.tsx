import { MapPinIcon, XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@workspace/ui/components/tooltip'
import { useState } from 'react'

import type { FsEntry } from '@/lib/file-system-types'
import { IconTooltip } from '@/components/icon-tooltip'
import { LocationSection } from '@/features/file-picker/components/location-section'
import { RecentSidebarSection } from '@/features/file-picker/components/recent-sidebar-section'
import { useFilePickerSessionActions } from '@/features/file-picker/hooks/use-file-picker-session-actions'
import { FilePickerSessionActionsContext } from '@/features/file-picker/providers/session-actions-context'
import type { EntriesLoadState } from '@/features/file-picker/utils/model'
import type { SidebarSection } from '@/features/file-picker/utils/sidebar-locations'

/**
 * The sidebar's recent folders, places, projects and drives behind one button, for pickers too
 * narrow for the sidebar. On a phone it opens as a bottom sheet; going to a place closes it.
 */
export function PlacesSheet({
  currentPath,
  labelled,
  recentState,
  sections,
}: {
  currentPath: string
  /** Shows the word beside the icon; an icon-only trigger names itself in a tooltip. */
  labelled: boolean
  recentState: EntriesLoadState
  sections: readonly SidebarSection[]
}) {
  const [open, setOpen] = useState(false)
  const actions = useFilePickerSessionActions()
  const closingActions = {
    ...actions,
    jumpTo: (path: string) => {
      setOpen(false)
      actions.jumpTo(path)
    },
    revealEntry: (entry: FsEntry) => {
      setOpen(false)
      actions.revealEntry(entry)
    },
  }
  const trigger = labelled ? (
    <PopoverTrigger
      render={
        <Button size='sm' type='button' variant='secondary'>
          <MapPinIcon data-icon='inline-start' />
          Places
        </Button>
      }
    />
  ) : (
    <Tooltip>
      <PopoverTrigger
        render={
          <TooltipTrigger
            render={
              <Button aria-label='Places' size='icon-sm' type='button' variant='ghost'>
                <MapPinIcon />
              </Button>
            }
          />
        }
      />
      <TooltipContent>Places</TooltipContent>
    </Tooltip>
  )

  return (
    <Popover onOpenChange={setOpen} open={open}>
      {trigger}
      <PopoverContent
        align='end'
        aria-label='Places'
        className='max-h-[min(32rem,var(--available-height))] w-72 gap-0 overflow-y-auto overscroll-contain'
        side='bottom'
      >
        <PopoverHeader className='mb-1 flex-row items-center justify-between pl-(--density-row-padding-x)'>
          <PopoverTitle>Places</PopoverTitle>
          <IconTooltip label='Close'>
            <Button
              aria-label='Close'
              onClick={() => setOpen(false)}
              size='icon-sm'
              type='button'
              variant='ghost'
            >
              <XIcon />
            </Button>
          </IconTooltip>
        </PopoverHeader>
        <FilePickerSessionActionsContext value={closingActions}>
          <div className='mb-(--density-section-gap)'>
            <RecentSidebarSection currentPath={currentPath} state={recentState} />
          </div>
          {sections.map((section) => (
            <LocationSection currentPath={currentPath} key={section.id} section={section} />
          ))}
        </FilePickerSessionActionsContext>
      </PopoverContent>
    </Popover>
  )
}
