import { ArrowsClockwiseIcon, PlusIcon } from '@phosphor-icons/react'
import { useState } from 'react'
import type { ProviderSnapshot } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'

import { McpAddDialog } from '@/features/settings/components/mcp-add-dialog'
import { McpConfigRow } from '@/features/settings/components/mcp-config-row'
import { McpListLoading } from '@/features/settings/components/mcp-list-loading'
import { useInstanceMcp } from '@/features/settings/hooks/use-instance-mcp'
import { groupMcpServers } from '@/features/settings/utils/mcp'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'

export function McpServerList({
  folder,
  instance,
  instances,
}: {
  readonly folder: string | null
  readonly instance: ProviderSnapshot
  readonly instances: readonly ProviderSnapshot[]
}) {
  const mcp = useInstanceMcp(instance.providerInstanceId, folder)
  const [adding, setAdding] = useState(false)
  const applies =
    instance.driverKind === 'codex'
      ? 'Running sessions pick up a change right away.'
      : 'Sessions you start after a change use it.'

  return (
    <section aria-label={`${instance.displayLabel} MCP servers`} className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-(--density-control-gap)'>
        <p className='text-muted-foreground min-w-0 flex-1 text-xs'>{applies}</p>
        <Button
          disabled={mcp.isFetching}
          onClick={() => void mcp.refetch()}
          size='sm'
          variant='ghost'
        >
          {mcp.isFetching ? <Spinner label='Reading MCP servers' /> : <ArrowsClockwiseIcon />}
          Check again
        </Button>
        <Button disabled={!mcp.data} onClick={() => setAdding(true)} size='sm' variant='outline'>
          <PlusIcon />
          Add server
        </Button>
      </div>
      {mcp.isPending ? <McpListLoading /> : null}
      {mcp.isError && !mcp.data ? (
        <EmptyState
          action={
            <Button onClick={() => void mcp.refetch()} size='sm' variant='outline'>
              Retry
            </Button>
          }
          align='start'
          description={clientErrorDescription(toClientError(mcp.error))}
          title='MCP servers could not be read'
          tone='error'
        />
      ) : null}
      {mcp.data && mcp.data.servers.length === 0 ? (
        <EmptyState
          align='start'
          description='Add one here, or with the agent’s own mcp command.'
          title='No MCP servers'
        />
      ) : null}
      {mcp.data
        ? groupMcpServers(mcp.data.servers).map(([source, servers]) => (
            <div className='flex flex-col' key={source}>
              <h3 className='section-label'>{source}</h3>
              <ul className='bg-muted flex flex-col rounded-lg px-(--density-control-padding-x)'>
                {servers.map((server) => (
                  <McpConfigRow
                    folder={folder}
                    instance={instance}
                    instances={instances}
                    key={server.name}
                    server={server}
                  />
                ))}
              </ul>
            </div>
          ))
        : null}
      {adding && mcp.data ? (
        <McpAddDialog
          folder={folder}
          instance={instance}
          onClose={() => setAdding(false)}
          scopes={mcp.data.scopes}
        />
      ) : null}
    </section>
  )
}
