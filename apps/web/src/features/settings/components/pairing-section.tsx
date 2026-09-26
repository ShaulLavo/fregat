import { Button } from '@workspace/ui/components/button'
import { EmptyState } from '@workspace/ui/components/empty-state'
import { LoadingState } from '@workspace/ui/components/loading-state'

import { InlineError } from '@/components/inline-error'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { PairedDeviceRow } from '@/features/settings/components/paired-device-row'
import { PairingLinkPanel } from '@/features/settings/components/pairing-link-panel'
import { usePairedDevices } from '@/features/settings/hooks/use-paired-devices'
import { usePairingLink } from '@/features/settings/hooks/use-pairing-link'
import { usePairingStatus } from '@/features/settings/hooks/use-pairing-status'

/**
 * The devices that may reach this machine from elsewhere, such as a phone over the mesh. Links
 * are made here, in this machine's own browser; any paired device can remove the others.
 */
export function PairingSection() {
  const status = usePairingStatus()
  const devices = usePairedDevices()
  const link = usePairingLink()
  const onThisMachine = status.data?.trust === 'host'

  return (
    <section
      aria-label='Paired devices'
      className='bg-muted mb-3 flex flex-col gap-3 rounded-lg p-3'
      data-pairing-section
    >
      <div className='space-y-1'>
        <h3 className='text-foreground text-sm font-medium'>Paired devices</h3>
        <p className='text-muted-foreground text-xs'>
          A paired device can use this machine’s files, terminals and agents, as you can at its
          keyboard. Pair a phone once, and remove it here to shut it out.
        </p>
      </div>
      {onThisMachine ? (
        <div>
          <Button
            disabled={link.isPending}
            size='sm'
            variant='outline'
            onClick={() => link.mutate()}
          >
            {link.data ? 'Make another link' : 'Pair a device'}
          </Button>
        </div>
      ) : null}
      {status.data && !onThisMachine ? (
        <p className='text-muted-foreground text-xs'>
          Pairing links are made in this machine’s own browser.
        </p>
      ) : null}
      {link.data ? <PairingLinkPanel link={link.data} key={link.data.code} /> : null}
      {link.isError ? (
        <InlineError
          message={clientErrorDescription(toClientError(link.error))}
          title='Pair a device'
        />
      ) : null}
      {devices.isPending ? (
        <LoadingState label='Loading paired devices' className='flex flex-col gap-2'>
          <div className='skeleton-sweep h-4 w-40 rounded-md' />
          <div className='skeleton-sweep h-3 w-56 rounded-md' />
        </LoadingState>
      ) : null}
      {devices.isError ? (
        <EmptyState
          action={
            <Button size='sm' variant='outline' onClick={() => void devices.refetch()}>
              Retry
            </Button>
          }
          align='start'
          title='Paired devices could not be loaded'
          tone='error'
        />
      ) : null}
      {devices.data?.length === 0 ? (
        <EmptyState
          align='start'
          description='A phone reaching this machine over the mesh shows a pairing screen until it is paired.'
          title='No paired devices'
        />
      ) : null}
      {devices.data && devices.data.length > 0 ? (
        <ul className='flex flex-col'>
          {devices.data.map((device) => (
            <PairedDeviceRow device={device} key={device.id} />
          ))}
        </ul>
      ) : null}
    </section>
  )
}
