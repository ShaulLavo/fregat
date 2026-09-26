import { cn } from '@workspace/ui/lib/utils'

import type { EffortTier } from '@/features/chat/utils/effort-tier'

/** Sits under the composer's content; its parent must be positioned and isolated. */
export function EffortBurstLayer({
  tier,
  onDone,
}: {
  readonly tier: EffortTier
  readonly onDone: () => void
}) {
  return (
    <span
      aria-hidden='true'
      className={cn(
        'pointer-events-none absolute inset-0 -z-10 overflow-hidden',
        tier === 'ultra' ? 'effort-burst-ultra' : 'effort-burst-max',
      )}
      data-effort-burst={tier}
    >
      <span className='effort-wash absolute inset-0' onAnimationEnd={onDone} />
      <span className='effort-sweep absolute inset-0' />
      {tier === 'ultra' ? (
        <span className='effort-sweep effort-sweep-trail absolute inset-0' />
      ) : null}
    </span>
  )
}
