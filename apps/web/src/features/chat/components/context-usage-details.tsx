import type { ScopedSessionRef } from '@workspace/contracts'
import { formatContextTokens, type ContextUsage } from '@workspace/client-core/chat/context-usage'

import { ContextSegmentsMeter } from '@/features/chat/components/context-segments-meter'
import { ContextTokenBreakdown } from '@/features/chat/components/context-token-breakdown'
import { SessionUsageTotal } from '@/features/chat/components/session-usage-total'

/** The ring's popover: what fills the window, the reserve behind 100 %, and the session's cost. */
export function ContextUsageDetails({
  sessionRef,
  usage,
}: {
  readonly sessionRef: ScopedSessionRef | null
  readonly usage: ContextUsage
}) {
  return (
    <>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-muted-foreground font-medium'>Context window</span>
        <span className='tabular-nums'>
          {usage.estimated ? '~' : ''}
          {formatContextTokens(usage.usedTokens)}
          {usage.maxTokens === null ? ' used' : ` / ${formatContextTokens(usage.maxTokens)}`}
        </span>
      </div>
      {usage.estimated ? (
        <p className='text-muted-foreground mt-1.5 leading-snug'>
          Estimate until the provider reports what the window holds.
        </p>
      ) : null}
      {usage.ratio === null ? (
        <p className='text-muted-foreground mt-1.5 leading-snug'>
          This provider did not report a window size, so the share used is unknown.
        </p>
      ) : null}
      {usage.segments && usage.maxTokens !== null ? (
        <ContextSegmentsMeter
          maxTokens={usage.maxTokens}
          reserveTokens={usage.reserveTokens}
          segments={usage.segments}
          usedTokens={usage.usedTokens}
        />
      ) : null}
      {!usage.segments && usage.breakdown ? (
        <ContextTokenBreakdown breakdown={usage.breakdown} />
      ) : null}
      {usage.reserveTokens ? (
        <div className='mt-1.5 flex items-baseline justify-between gap-3'>
          <span className='text-muted-foreground'>Reserved for compaction</span>
          <span className='tabular-nums'>{formatContextTokens(usage.reserveTokens)}</span>
        </div>
      ) : null}
      {usage.totalProcessedTokens === null ? null : (
        <div className='mt-1.5 flex items-baseline justify-between gap-3'>
          <span className='text-muted-foreground'>Processed this session</span>
          <span className='tabular-nums'>{formatContextTokens(usage.totalProcessedTokens)}</span>
        </div>
      )}
      {usage.compactsAutomatically ? (
        <p className='text-muted-foreground mt-1.5 leading-snug'>
          This provider compacts the context on its own when it fills.
        </p>
      ) : null}
      {sessionRef ? <SessionUsageTotal sessionRef={sessionRef} /> : null}
    </>
  )
}
