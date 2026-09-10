import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'
import { useSshHosts } from '@/hooks/use-ssh-hosts'
import { SshHostOption } from '@/components/ssh-host-option'

export function SshHostList({
  value,
  onSelect,
}: {
  readonly value: string
  readonly onSelect: (target: string) => void
}) {
  const query = useSshHosts()
  if (query.isPending)
    return (
      <LoadingState label='Loading SSH hosts' className='space-y-2 p-3'>
        <div className='skeleton-sweep h-7 rounded' />
        <div className='skeleton-sweep h-7 rounded' />
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
          <Button type='button' variant='outline' size='sm' onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      />
    )
  const hosts = query.data
  const search = value.trim().toLowerCase()
  const matching = hosts.filter((host) => host.toLowerCase().includes(search))
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
    <div className='max-h-48 overflow-y-auto p-1'>
      {matching.map((host) => (
        <SshHostOption key={host} target={host} selected={host === value} onSelect={onSelect} />
      ))}
    </div>
  )
}
