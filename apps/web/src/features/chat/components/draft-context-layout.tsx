import {
  CaretUpIcon,
  FolderIcon,
  GitBranchIcon,
  GitForkIcon,
  RobotIcon,
} from '@phosphor-icons/react'
import type { ReactNode } from 'react'
import type { RepositoryKind } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@workspace/ui/components/popover'
import { usePresentation } from '@workspace/ui/patterns/sheet'

const ICONS = { git: GitBranchIcon, directory: FolderIcon, new: GitForkIcon }
const LABELS = { git: 'Current checkout', directory: 'Workspace', new: 'New worktree' }

export function DraftContextLayout({
  agent,
  branch,
  children,
  kind,
  path,
}: {
  readonly agent: string | null
  readonly branch: string
  readonly children: ReactNode
  readonly kind: RepositoryKind | 'new'
  readonly path: string
}) {
  const presentation = usePresentation()
  if (presentation !== 'sheet') return children
  const Icon = ICONS[kind]

  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            aria-label='Session setup'
            className='text-muted-foreground flex w-full min-w-0 gap-(--density-control-gap) font-normal'
            size='sm'
            title={`${LABELS[kind]} · ${branch} · ${agent ?? 'Default agent'}`}
            variant='ghost'
          >
            <Icon className='size-(--icon-size-sm) shrink-0' />
            <span className='min-w-0 flex-1 truncate text-left font-mono'>{branch}</span>
            <RobotIcon className='size-(--icon-size-sm) shrink-0' />
            <span className='max-w-1/3 truncate'>{agent ?? 'Default'}</span>
            <CaretUpIcon className='size-(--icon-size-sm) shrink-0' />
          </Button>
        }
      />
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Session setup</PopoverTitle>
          <PopoverDescription className='break-all'>{path}</PopoverDescription>
        </PopoverHeader>
        {children}
      </PopoverContent>
    </Popover>
  )
}
