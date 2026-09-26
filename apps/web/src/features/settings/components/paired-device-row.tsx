import type { PairedDevice } from '@workspace/contracts'
import { Button } from '@workspace/ui/components/button'

import { InlineError } from '@/components/inline-error'
import { clientErrorDescription, toClientError } from '@/lib/client-error-taxonomy'
import { usePairedDeviceRemove } from '@/features/settings/hooks/use-paired-device-remove'

const DAY = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const MOMENT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export function PairedDeviceRow({ device }: { readonly device: PairedDevice }) {
  const remove = usePairedDeviceRemove(device.id)

  return (
    <li
      className='flex flex-col gap-(--density-gap-tight) py-(--density-gap-tight)'
      data-paired-device={device.id}
    >
      <div className='flex flex-wrap items-center justify-between gap-(--density-section-gap)'>
        <div className='flex min-w-0 flex-1 flex-col'>
          <span className='text-foreground truncate text-sm' title={device.label}>
            {device.label}
          </span>
          <span className='text-muted-foreground text-2xs'>
            {device.current ? 'This device · ' : ''}Paired{' '}
            <span className='font-mono'>{DAY.format(new Date(device.pairedAt))}</span> · last seen{' '}
            <span className='font-mono'>{MOMENT.format(new Date(device.lastSeenAt))}</span>
          </span>
        </div>
        {device.current ? null : (
          <Button
            disabled={remove.isPending}
            size='sm'
            variant='ghost'
            onClick={() => remove.mutate()}
          >
            Remove
          </Button>
        )}
      </div>
      {remove.isError ? (
        <InlineError
          message={clientErrorDescription(toClientError(remove.error))}
          title={`Remove ${device.label}`}
        />
      ) : null}
    </li>
  )
}
