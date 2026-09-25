import { CaretDownIcon, GitBranchIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'

import { DraftBranchList } from './draft-branch-list'

/** Where a new worktree starts. The list loads only once the menu is opened. */
export function DraftBranchMenu({
  rootPath,
  value,
  onSelect,
}: {
  readonly rootPath: string
  /** The branch the new worktree starts from. */
  readonly value: string
  readonly onSelect: (branch: string) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Start from branch'
            className='text-muted-foreground min-w-0 gap-1 text-xs font-normal'
            size='sm'
            title={`New worktree starts from ${value}`}
            type='button'
            variant='ghost'
          >
            <GitBranchIcon className='size-(--icon-size-sm) shrink-0' />
            <span className='truncate'>From {value}</span>
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='end' className='max-h-80 w-64 p-1' side='top'>
        <DraftBranchList rootPath={rootPath} value={value} onSelect={onSelect} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
