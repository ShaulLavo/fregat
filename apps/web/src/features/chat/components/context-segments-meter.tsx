import type { ContextSegment } from '@workspace/client-core/chat/context-usage'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { cn } from '@workspace/ui/lib/utils'

import { chartFill } from '@/lib/chart-fills'

/**
 * What fills the window, as one bar split by category, then a legend row each.
 * The reserve closes the bar; deferred rows are listed apart because they are
 * not in the window.
 */
export function ContextSegmentsMeter({
  maxTokens,
  reserveTokens,
  segments,
  usedTokens,
}: {
  readonly maxTokens: number
  readonly reserveTokens: number | null
  readonly segments: readonly ContextSegment[]
  readonly usedTokens: number
}) {
  const used = segments.filter((segment) => segment.kind === 'used')
  const deferred = segments.filter((segment) => segment.kind === 'deferred')
  const span = maxTokens + (reserveTokens ?? 0)
  return (
    <div className='mt-2 flex flex-col gap-1'>
      <div
        aria-label='Context window by category'
        aria-valuemax={maxTokens}
        aria-valuemin={0}
        aria-valuenow={usedTokens}
        className='bg-muted flex h-1.5 w-full overflow-hidden rounded-full'
        role='meter'
      >
        {used.map((segment, index) => (
          <span
            className={cn('h-full', chartFill(index))}
            key={segment.name}
            style={{ width: `${(segment.tokens / span) * 100}%` }}
          />
        ))}
        {reserveTokens ? (
          <span
            className='bg-muted-foreground/40 ml-auto h-full'
            style={{ width: `${(reserveTokens / span) * 100}%` }}
          />
        ) : null}
      </div>
      {used.map((segment, index) => (
        <div
          className='flex items-center gap-1.5'
          key={segment.name}
          title={`${segment.name} · ${segment.tokens.toLocaleString()} tokens`}
        >
          <span className={cn('size-2 shrink-0 rounded-full', chartFill(index))} />
          <span className='text-muted-foreground min-w-0 flex-1 truncate'>{segment.name}</span>
          <span className='tabular-nums'>{formatContextTokens(segment.tokens)}</span>
        </div>
      ))}
      {deferred.length > 0 ? (
        <p className='text-muted-foreground text-2xs mt-1'>
          Not in the window until used:{' '}
          {deferred
            .map((segment) => `${segment.name} ${formatContextTokens(segment.tokens)}`)
            .join(' · ')}
        </p>
      ) : null}
    </div>
  )
}
