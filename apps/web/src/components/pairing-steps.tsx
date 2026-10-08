import type { DeviceKind } from '@/lib/pairing/utils/device-label'

const STEP = 'flex gap-2 text-xs text-muted-foreground'
const NUMBER =
  'bg-background text-muted-foreground text-2xs flex size-4.5 shrink-0 items-center justify-center rounded-full font-mono tabular-nums'
const PLACE = 'text-foreground font-medium'

/** Where a code comes from: the machine, or any device already paired with it. */
export function PairingSteps({
  kind,
  machine,
}: {
  readonly kind: DeviceKind
  readonly machine: string
}) {
  return (
    <ol className='bg-muted flex flex-col gap-(--density-gap-tight) rounded-lg p-(--density-section-gap)'>
      <li className={STEP}>
        <span className={NUMBER}>1</span>
        <span>
          On <span className={PLACE}>{machine}</span> or a device already paired with it, open{' '}
          <span className={PLACE}>Settings › Machines › Pair a device</span>.
        </span>
      </li>
      <li className={STEP}>
        <span className={NUMBER}>2</span>
        <span>
          {kind === 'browser'
            ? 'Open its link here, or type the code below.'
            : `Scan its QR code with this ${kind}, or type the code below.`}
        </span>
      </li>
    </ol>
  )
}
