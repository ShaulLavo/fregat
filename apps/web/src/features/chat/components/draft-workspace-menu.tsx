import { CaretDownIcon, FolderIcon, FoldersIcon, GitForkIcon } from '@phosphor-icons/react'
import type { OrchestrationWorktreeShell, SessionWorktreeTarget } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Spinner } from '@workspace/ui/components/spinner'

import { WORKSPACE_CHOICE_LABELS, workspaceChoiceLabel } from '../utils/draft-workspace'
import { WidestLabel } from '@workspace/ui/components/widest-label'
import { DraftWorkspaceList } from './draft-workspace-list'

const ICONS = { current: FolderIcon, linked: FoldersIcon, new: GitForkIcon } as const

export function DraftWorkspaceMenu({
  base,
  currentCheckout,
  worktrees,
  target,
  pending,
  onNew,
  onWorktree,
}: {
  /** The worktree the draft sits on. */
  readonly base: OrchestrationWorktreeShell
  /** The project's main checkout on this machine. */
  readonly currentCheckout: OrchestrationWorktreeShell | null
  /** Ready linked worktrees, the draft's own included when it sits on one. */
  readonly worktrees: readonly OrchestrationWorktreeShell[]
  readonly target: SessionWorktreeTarget
  readonly pending: boolean
  readonly onNew: () => void
  readonly onWorktree: (worktree: OrchestrationWorktreeShell) => void
}) {
  const choice = workspaceChoiceLabel(base, target)
  const Icon = ICONS[choice.kind]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            aria-label='Workspace'
            className='text-muted-foreground min-w-0 gap-1 text-xs font-normal'
            disabled={pending}
            size='sm'
            title={target.kind === 'new' ? 'A new worktree, made when you send' : base.path}
            type='button'
            variant='ghost'
          >
            {pending ? (
              <Spinner size='xs' label='Moving draft' />
            ) : (
              <Icon className='size-(--icon-size-sm) shrink-0' />
            )}
            <WidestLabel labels={WORKSPACE_CHOICE_LABELS}>{choice.label}</WidestLabel>
            <CaretDownIcon className='size-(--icon-size-sm) shrink-0 opacity-60' />
          </Button>
        }
      />
      <DropdownMenuContent align='start' className='w-64 p-1' side='top'>
        <DraftWorkspaceList
          base={base}
          currentCheckout={currentCheckout}
          target={target}
          worktrees={worktrees}
          onNew={onNew}
          onWorktree={onWorktree}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
