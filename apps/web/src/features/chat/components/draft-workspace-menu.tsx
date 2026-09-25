import { CaretDownIcon, FolderIcon, FoldersIcon, GitForkIcon } from '@phosphor-icons/react'
import type { OrchestrationWorktreeShell, SessionWorktreeTarget } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@workspace/ui/components/dropdown-menu'
import { Spinner } from '@workspace/ui/components/spinner'

import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'
import { WORKSPACE_CHOICE_LABELS, workspaceChoiceLabel } from '../utils/draft-workspace'
import { WidestLabel } from '@workspace/ui/components/widest-label'

const NEW_WORKTREE = 'new'
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
  const capability = base.worktreeCreationCapability
  const choice = workspaceChoiceLabel(base, target)
  const checkout = currentCheckout ?? (base.kind === 'current' ? base : null)
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
        <DropdownMenuRadioGroup
          aria-label='Workspace'
          value={target.kind === 'new' ? NEW_WORKTREE : base.id}
        >
          <DropdownMenuLabel>Workspace</DropdownMenuLabel>
          {checkout ? (
            <DropdownMenuRadioItem
              closeOnClick
              disabled={checkout.lifecycle.state !== 'ready'}
              value={checkout.id}
              onClick={() => onWorktree(checkout)}
            >
              <FolderIcon className='size-(--icon-size-sm)' />
              Current checkout
            </DropdownMenuRadioItem>
          ) : null}
          <DropdownMenuRadioItem
            closeOnClick
            disabled={!capability.allowed}
            value={NEW_WORKTREE}
            onClick={onNew}
          >
            <GitForkIcon className='size-(--icon-size-sm)' />
            New worktree
          </DropdownMenuRadioItem>
          {capability.allowed ? null : (
            <p className='text-muted-foreground px-2 pb-1 text-xs'>
              {capability.reason === 'not-git'
                ? 'New worktrees require a Git repository.'
                : 'This checkout is not ready for a new worktree.'}
            </p>
          )}
        </DropdownMenuRadioGroup>
        {worktrees.length > 0 ? (
          <DropdownMenuRadioGroup
            aria-label='Worktrees'
            value={target.kind === 'new' ? NEW_WORKTREE : base.id}
          >
            <DropdownMenuSeparator className='my-1' />
            <DropdownMenuLabel>Worktrees</DropdownMenuLabel>
            {worktrees.map((worktree) => (
              <DropdownMenuRadioItem
                key={worktree.id}
                closeOnClick
                title={worktree.path}
                value={worktree.id}
                onClick={() => onWorktree(worktree)}
              >
                <FoldersIcon className='size-(--icon-size-sm)' />
                <span className='truncate'>{worktreeLabel(worktree, 'git')}</span>
                {worktree.cleanupEligibility.nonDeletedSessionCount > 0 ? (
                  <span className='text-muted-foreground text-2xs ml-auto tabular-nums'>
                    {worktree.cleanupEligibility.nonDeletedSessionCount}
                  </span>
                ) : null}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
