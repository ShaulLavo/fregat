import { useQuery } from '@tanstack/react-query'
import type { ScopedSessionRef } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { Spinner } from '@workspace/ui/components/spinner'

import { SessionCost } from '@/features/chat/components/session-cost'
import { sessionUsageTotalQueryOptions } from '@/features/chat/utils/provider-usage-query'

/** What this session has cost so far. Unknown cost says so; unpriced tokens are named. */
export function SessionUsageTotal({ sessionRef }: { readonly sessionRef: ScopedSessionRef }) {
  const total = useQuery(sessionUsageTotalQueryOptions(sessionRef, true))

  return (
    <div className='mt-2 flex items-baseline justify-between gap-3'>
      <span className='text-muted-foreground'>This session</span>
      {total.isPending ? <Spinner size='xs' /> : null}
      {total.isError ? <span className='text-muted-foreground'>Unavailable</span> : null}
      {total.isSuccess ? (
        <span
          className='tabular-nums'
          title={
            total.data.unpricedTokens > 0
              ? `${formatContextTokens(total.data.unpricedTokens)} tokens have no price and are not in the cost`
              : undefined
          }
        >
          {formatContextTokens(total.data.tokens)} tokens ·{' '}
          <SessionCost costUsd={total.data.costUsd} />
        </span>
      ) : null}
    </div>
  )
}
