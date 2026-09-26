import { useQuery } from '@tanstack/react-query'
import { DropdownMenuLabel, DropdownMenuRadioGroup } from '@workspace/ui/components/dropdown-menu'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { errorMessage } from '@/lib/error-message'
import { branchesQueryOptions } from '../utils/branch-query'
import { DraftBranchRows } from './draft-branch-rows'

export function DraftBranchList({
  rootPath,
  value,
  onSelect,
}: {
  readonly rootPath: string
  readonly value: string
  readonly onSelect: (branch: string) => void
}) {
  const query = useQuery(branchesQueryOptions(rootPath))

  return (
    <DropdownMenuRadioGroup aria-label='Start from branch' value={value}>
      <DropdownMenuLabel>Start from</DropdownMenuLabel>
      {!query.isFetchedAfterMount ? (
        <LoadingState label='Loading branches' className='px-2 py-1'>
          <div aria-hidden='true' className='skeleton-sweep h-3 w-28 rounded-md' />
        </LoadingState>
      ) : null}
      {query.isError ? (
        <p className='text-muted-foreground px-2 pb-1 text-xs' role='status'>
          {errorMessage(query.error, 'Could not list branches.')}
        </p>
      ) : null}
      {query.isFetchedAfterMount && query.data ? (
        <DraftBranchRows
          branches={query.data.branches}
          worktrees={query.data.worktrees}
          value={value}
          onSelect={onSelect}
        />
      ) : null}
    </DropdownMenuRadioGroup>
  )
}
