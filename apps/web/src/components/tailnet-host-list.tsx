import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { useTailnetHosts } from '@/hooks/use-tailnet-hosts'
import { SshHostOption } from '@/components/ssh-host-option'
import { tailnetUnavailableMessage } from '@/utils/tailnet-hosts'

export function TailnetHostList({
  value,
  onSelect,
}: {
  readonly value: string
  readonly onSelect: (target: string) => void
}) {
  const query = useTailnetHosts()
  if (query.isPending)
    return (
      <LoadingState label='Loading tailnet machines' className='space-y-2 p-3'>
        <div className='skeleton-sweep h-7 rounded' />
        <div className='skeleton-sweep h-7 rounded' />
      </LoadingState>
    )
  if (query.isError)
    return (
      <EmptyState
        align='start'
        title='Could not read tailnet machines'
        description='You can still select an SSH host or enter an address.'
        tone='error'
        action={
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? <Spinner /> : null}Retry tailnet
          </Button>
        }
      />
    )
  const discovery = query.data
  if (discovery.status === 'unavailable')
    return (
      <EmptyState
        align='start'
        title='Tailnet unavailable'
        description={tailnetUnavailableMessage(discovery.reason)}
        action={
          <Button
            type='button'
            variant='ghost'
            size='sm'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? <Spinner /> : null}Refresh tailnet
          </Button>
        }
      />
    )
  if (discovery.hosts.length === 0)
    return (
      <EmptyState
        align='start'
        title='No tailnet machines'
        description='Other machines will appear here when they join this tailnet.'
      />
    )
  const search = value.trim().toLowerCase()
  const matching = discovery.hosts.filter(
    (host) =>
      host.target.toLowerCase().includes(search) || host.label.toLowerCase().includes(search),
  )
  if (matching.length === 0)
    return <EmptyState align='start' title='No matching tailnet machines' />
  return (
    <div className='max-h-48 overflow-y-auto p-1'>
      {matching.map((host) => (
        <SshHostOption
          key={host.target}
          target={host.target}
          label={host.label}
          offline={!host.online}
          selected={host.target === value}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
