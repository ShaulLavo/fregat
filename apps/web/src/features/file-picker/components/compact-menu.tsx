import {
  ArrowClockwiseIcon,
  DotsThreeIcon,
  PencilSimpleIcon,
  PushPinIcon,
} from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSwitchItem,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { IconTooltip } from '@/components/icon-tooltip'
import { usePickerLocationActions } from '@/features/file-picker/hooks/use-picker-location-actions'
import type { FileListSort, FileListSortKey } from '@/features/file-picker/utils/sort-entries'

const SORTS: readonly {
  key: FileListSortKey
  label: string
  direction: FileListSort['direction']
}[] = [
  { key: 'name', label: 'Name', direction: 'ascending' },
  { key: 'modified', label: 'Newest first', direction: 'descending' },
  { key: 'size', label: 'Largest first', direction: 'descending' },
]

/** The phone picker's less frequent actions, which the desktop bar shows as buttons. */
export function CompactMenu({
  currentPath,
  hiddenDisabled,
  onGoToFolder,
  onRefresh,
  onSort,
  onToggleHidden,
  showHidden,
  sort,
}: {
  currentPath: string
  hiddenDisabled: boolean
  onGoToFolder: () => void
  onRefresh: () => void
  onSort: (sort: FileListSort) => void
  onToggleHidden: () => void
  showHidden: boolean
  sort: FileListSort | null
}) {
  const locations = usePickerLocationActions()
  const pinned = locations.pinned.includes(currentPath)

  return (
    <DropdownMenu>
      <IconTooltip label='More folder actions'>
        <DropdownMenuTrigger
          render={
            <Button aria-label='More folder actions' size='icon' type='button' variant='ghost'>
              <DotsThreeIcon className='size-(--icon-size)' />
            </Button>
          }
        />
      </IconTooltip>
      <DropdownMenuContent align='end' className='w-56'>
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={onGoToFolder}>
            <PencilSimpleIcon />
            Go to folder…
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => (pinned ? locations.unpin(currentPath) : locations.pin(currentPath))}
          >
            {pinned ? <PushPinIcon weight='fill' /> : <PushPinIcon weight='regular' />}
            {pinned ? 'Unpin this folder' : 'Pin this folder'}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onRefresh}>
            <ArrowClockwiseIcon />
            Refresh
          </DropdownMenuItem>
          <DropdownMenuSwitchItem
            checked={showHidden}
            disabled={hiddenDisabled}
            onCheckedChange={onToggleHidden}
          >
            Show hidden files
          </DropdownMenuSwitchItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={sort?.key ?? ''}>
          <DropdownMenuLabel>Sort</DropdownMenuLabel>
          {SORTS.map((option) => (
            <DropdownMenuRadioItem
              key={option.key}
              onClick={() => onSort({ key: option.key, direction: option.direction })}
              value={option.key}
            >
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
