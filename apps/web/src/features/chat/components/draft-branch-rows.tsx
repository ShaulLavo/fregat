import { useState } from 'react'
import type { GitBranch, GitWorktree } from '@workspace/contracts'
import { DropdownMenuRadioItem } from '@workspace/ui/components/dropdown-menu'
import { branchLanes } from '../utils/branch-lanes'
import { baseBranchChoices } from '../utils/draft-workspace'
import { BranchLane } from './branch-lane'

export function DraftBranchRows({
  branches,
  worktrees,
  value,
  onSelect,
}: {
  readonly branches: readonly GitBranch[]
  readonly worktrees: readonly GitWorktree[]
  readonly value: string
  readonly onSelect: (branch: string) => void
}) {
  // Freeze ordering and gutter width until this menu closes.
  const [layout] = useState(() => branchLanes(baseBranchChoices(branches), worktrees))
  return layout.rows.map((row) => (
    <DropdownMenuRadioItem
      key={row.branch.name}
      aria-label={row.branch.name}
      closeOnClick
      title={[
        row.branch.name,
        row.parent && `Created from ${row.parent}`,
        row.branch.upstream && `Tracks ${row.branch.upstream}`,
      ]
        .filter(Boolean)
        .join(' · ')}
      value={row.branch.name}
      onClick={() => onSelect(row.branch.name)}
    >
      {layout.lanes ? (
        <span aria-hidden className='shrink-0' style={{ width: layout.lanes * 12 }}>
          <BranchLane row={row} lanes={layout.lanes} selected={row.branch.name === value} />
        </span>
      ) : null}
      <span className='truncate'>{row.branch.name}</span>
      {row.branch.current ? (
        <span className='text-muted-foreground text-2xs ml-auto'>Checked out</span>
      ) : null}
    </DropdownMenuRadioItem>
  ))
}
