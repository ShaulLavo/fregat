import { BrainIcon, LightningIcon } from '@phosphor-icons/react'

/** A bolt whenever fast mode is on; the brain only stands in for the dropped label. */
export function ModelOptionsTriggerIcon({
  compact,
  fast,
}: {
  readonly compact: boolean
  readonly fast: boolean
}) {
  if (fast)
    return (
      <LightningIcon className='text-foreground size-(--icon-size-sm) shrink-0' weight='fill' />
    )
  if (!compact) return null
  return <BrainIcon className='size-(--icon-size-sm) shrink-0 opacity-70' />
}
