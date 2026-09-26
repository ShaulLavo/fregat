import type { PairingLink } from '@workspace/contracts'

import { CopyButton } from '@/components/copy-button'
import { PairingQr } from '@/features/settings/components/pairing-qr'
import { pairingLink } from '@/lib/pairing/utils/link'

const TIME = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** A fresh link, shown once: nothing else keeps it, and it works for one device within 5 minutes. */
export function PairingLinkPanel({ link }: { readonly link: PairingLink }) {
  const href = pairingLink(new URL(import.meta.env.BASE_URL, window.location.href).href, link.code)

  return (
    <div className='bg-background flex flex-wrap items-center gap-(--density-section-gap) rounded-lg p-(--density-section-gap)'>
      <PairingQr value={href} />
      <div className='flex min-w-0 flex-1 flex-col gap-(--density-gap-tight)'>
        <p className='text-foreground text-xs'>Scan with the device, or open the link on it.</p>
        <p className='text-muted-foreground text-2xs font-mono break-all' data-pairing-link>
          {href}
        </p>
        <p className='text-muted-foreground text-2xs'>
          Works once, until{' '}
          <span className='font-mono tabular-nums'>{TIME.format(new Date(link.expiresAt))}</span>.
          Code <span className='font-mono'>{link.code}</span>.
        </p>
        <div>
          <CopyButton label='pairing link' text={href} variant='outline' />
        </div>
      </div>
    </div>
  )
}
