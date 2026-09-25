import { useQuery } from '@tanstack/react-query'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@workspace/ui/components/dropdown-menu'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { errorMessage } from '@/lib/error-message'
import { branchesQueryOptions } from '../utils/branch-query'
import { baseBranchChoices } from '../utils/draft-workspace'

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
  const branches = baseBranchChoices(query.data?.branches ?? [])

  return (
    <DropdownMenuRadioGroup aria-label='Start from branch' value={value}>
      <DropdownMenuLabel>Start from</DropdownMenuLabel>
      {query.isPending ? (
        <LoadingState label='Loading branches' className='px-2 py-1'>
          <div aria-hidden='true' className='skeleton-sweep h-3 w-28 rounded-md' />
        </LoadingState>
      ) : null}
      {query.isError ? (
        <p className='text-muted-foreground px-2 pb-1 text-xs' role='status'>
          {errorMessage(query.error, 'Could not list branches.')}
        </p>
      ) : null}
      {branches.map((branch) => (
        <DropdownMenuRadioItem
          key={branch.name}
          closeOnClick
          title={branch.upstream ? `${branch.name} · tracks ${branch.upstream}` : branch.name}
          value={branch.name}
          onClick={() => onSelect(branch.name)}
        >
          <span className='truncate'>{branch.name}</span>
          {branch.current ? (
            <span className='text-muted-foreground text-2xs ml-auto'>Checked out</span>
          ) : null}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
