import { BrainIcon, LightningIcon } from '@phosphor-icons/react'
import { useId } from 'react'

import { RAINBOW_STOP_OFFSETS } from '@/features/chat/utils/effort-tier'

/** A bolt whenever fast mode is on; the brain only stands in for the dropped label. */
export function ModelOptionsTriggerIcon({
  compact,
  fast,
  ultra,
}: {
  readonly compact: boolean
  readonly fast: boolean
  /** Paints the brain with the rainbow the dropped label would have worn. */
  readonly ultra: boolean
}) {
  // A url(#…) reference cannot hold the punctuation React puts in its ids.
  const gradientId = `rainbow${useId().replace(/[^\w-]/g, '')}`
  if (fast)
    return (
      <LightningIcon className='text-foreground size-(--icon-size-sm) shrink-0' weight='fill' />
    )
  if (!compact) return null
  if (!ultra) return <BrainIcon className='size-(--icon-size-sm) shrink-0 opacity-70' />

  return (
    <BrainIcon
      className='rainbow-hue group-hover/options:rainbow-live group-data-popup-open/options:rainbow-live size-(--icon-size-sm) shrink-0'
      color={`url(#${gradientId})`}
      weight='bold'
    >
      <defs>
        <linearGradient id={gradientId} x1='0' x2='1' y1='0' y2='1'>
          {/* Colours come from `rainbow-hue`, by position. */}
          {RAINBOW_STOP_OFFSETS.map((offset) => (
            <stop key={offset} offset={offset} />
          ))}
        </linearGradient>
      </defs>
    </BrainIcon>
  )
}
