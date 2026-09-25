import { HostListLoading } from '@/features/environments/components/host-list-loading'
import { useState } from 'react'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { Spinner } from '@workspace/ui/components/spinner'
import { useTailnetHosts } from '@/features/environments/hooks/use-tailnet-hosts'
import { SshHostOption } from '@/features/environments/components/ssh-host-option'
import { tailnetUnavailableMessage } from '@/features/environments/utils/tailnet-hosts'

export function TailnetHostList({
  value,
  onSelect,
}: {
  readonly value: string
  readonly onSelect: (target: string) => void
}) {
  const query = useTailnetHosts()
  const hosts = query.data?.status === 'available' ? query.data.hosts : []
  const search = value.trim().toLowerCase()
  const matching = hosts.filter(
    (host) =>
      host.target.toLowerCase().includes(search) || host.label.toLowerCase().includes(search),
  )
  const [activeId, setActiveId] = useState<string | null>(null)
  const list = useListbox({
    role: 'listbox',
    items: matching.map((host) => ({ id: host.target, label: host.label })),
    activeId: activeId ?? value,
    onActiveChange: setActiveId,
    onCommit: onSelect,
  })
  if (query.isPending) return <HostListLoading label='Loading tailnet machines' />
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
  if (matching.length === 0)
    return <EmptyState align='start' title='No matching tailnet machines' />
  return (
    <div
      {...list.containerProps}
      aria-label='Tailnet hosts'
      className='focus-ring-inset max-h-48 overflow-y-auto'
    >
      {matching.map((host) => (
        <SshHostOption
          key={host.target}
          rowProps={list.rowProps(host.target)}
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
