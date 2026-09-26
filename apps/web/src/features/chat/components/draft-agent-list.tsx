import { useQuery } from '@tanstack/react-query'
import type { ProviderInstanceId } from '@workspace/contracts'
import {
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@workspace/ui/components/dropdown-menu'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { errorMessage } from '@/lib/error-message'
import { providerCommandCatalogQueryOptions } from '../utils/composer-skills'

const DEFAULT_AGENT = ''

export function DraftAgentList({
  cwd,
  enabled,
  onSelect,
  providerInstanceId,
  value,
}: {
  readonly cwd: string
  readonly enabled: boolean
  readonly onSelect: (agent: string | null) => void
  readonly providerInstanceId: ProviderInstanceId | null
  readonly value: string | null
}) {
  const query = useQuery(providerCommandCatalogQueryOptions({ cwd, enabled, providerInstanceId }))
  const agents = query.data?.agents ?? []

  return (
    <DropdownMenuRadioGroup aria-label='Run as agent' value={value ?? DEFAULT_AGENT}>
      <DropdownMenuLabel>Run as</DropdownMenuLabel>
      <DropdownMenuRadioItem closeOnClick value={DEFAULT_AGENT} onClick={() => onSelect(null)}>
        Default agent
      </DropdownMenuRadioItem>
      {query.isLoading ? (
        <LoadingState label='Loading agents' className='px-2 py-1'>
          <div aria-hidden='true' className='skeleton-sweep h-3 w-28 rounded-md' />
        </LoadingState>
      ) : null}
      {query.isError ? (
        <p className='text-muted-foreground px-2 pb-1 text-xs' role='status'>
          {errorMessage(query.error, 'Could not list agents.')}
        </p>
      ) : null}
      {query.isSuccess && agents.length === 0 ? (
        <p className='text-muted-foreground px-2 pb-1 text-xs' role='status'>
          This provider lists no agent definitions for the project.
        </p>
      ) : null}
      {agents.map((agent) => (
        <DropdownMenuRadioItem
          className='flex-col items-start gap-0'
          closeOnClick
          key={agent.name}
          title={agent.description ? `${agent.name} · ${agent.description}` : agent.name}
          value={agent.name}
          onClick={() => onSelect(agent.name)}
        >
          <span className='max-w-full truncate'>{agent.name}</span>
          {agent.description ? (
            <span className='text-muted-foreground text-2xs max-w-full truncate'>
              {agent.description}
            </span>
          ) : null}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}
