import { useState } from 'react'
import { useListbox } from '@workspace/ui/patterns/use-listbox'
import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { OrbitLoader } from '@workspace/ui/components/orbit-loader'
import { useSshHosts } from '@/features/environments/hooks/use-ssh-hosts'
import { SshHostOption } from '@/features/environments/components/ssh-host-option'

export function SshHostList({
  value,
  onSelect,
}: {
  readonly value: string
  readonly onSelect: (target: string) => void
}) {
  const query = useSshHosts()
  const hosts = query.data ?? []
  const search = value.trim().toLowerCase()
  const matching = hosts.filter((host) => host.toLowerCase().includes(search))
  const [activeId, setActiveId] = useState<string | null>(null)
  const list = useListbox({
    role: 'listbox',
    items: matching.map((host) => ({ id: host, label: host })),
    activeId: activeId ?? value,
    onActiveChange: setActiveId,
    onCommit: onSelect,
  })
  if (query.isPending)
    return (
      <LoadingState label='Loading SSH hosts' className='space-y-2 p-3'>
        <div className='skeleton-sweep h-7 rounded-md' />
        <div className='skeleton-sweep h-7 rounded-md' />
      </LoadingState>
    )
  if (query.isError)
    return (
      <EmptyState
        align='start'
        title='Could not read SSH hosts'
        description='You can still enter an address above.'
        tone='error'
        action={
          <Button
            type='button'
            variant='outline'
            size='sm'
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            {query.isFetching ? <OrbitLoader /> : null}Retry
          </Button>
        }
      />
    )
  if (hosts.length === 0)
    return (
      <EmptyState
        align='start'
        title='No hosts in SSH config'
        description='Enter an SSH address above to connect.'
      />
    )
  if (matching.length === 0)
    return (
      <EmptyState
        align='start'
        title='No matching SSH hosts'
        description='You can connect using the address entered above.'
      />
    )

  return (
    <div
      {...list.containerProps}
      aria-label='SSH hosts'
      className='focus-ring-inset max-h-48 overflow-y-auto'
    >
      {matching.map((host) => (
        <SshHostOption
          key={host}
          rowProps={list.rowProps(host)}
          target={host}
          selected={host === value}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
