import { FolderIcon, FoldersIcon, GitForkIcon } from '@phosphor-icons/react'
import type { OrchestrationWorktreeShell, SessionWorktreeTarget } from '@workspace/contracts'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@workspace/ui/components/dropdown-menu'

import { worktreeLabel } from '@workspace/client-core/chat/worktrees/label'

const NEW_WORKTREE = 'new'

/** Where the session runs: the main checkout, a new worktree, or a ready linked worktree. */
export function DraftWorkspaceList({
  base,
  currentCheckout,
  worktrees,
  target,
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
  readonly onNew: () => void
  readonly onWorktree: (worktree: OrchestrationWorktreeShell) => void
}) {
  const capability = base.worktreeCreationCapability
  const checkout = currentCheckout ?? (base.kind === 'current' ? base : null)
  const value = target.kind === 'new' ? NEW_WORKTREE : base.id

  return (
    <>
      <DropdownMenuRadioGroup aria-label='Workspace' value={value}>
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
        <DropdownMenuRadioGroup aria-label='Worktrees' value={value}>
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
                <span className='text-muted-foreground text-2xs ml-auto font-mono tabular-nums'>
                  {worktree.cleanupEligibility.nonDeletedSessionCount}
                </span>
              ) : null}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      ) : null}
    </>
  )
}
