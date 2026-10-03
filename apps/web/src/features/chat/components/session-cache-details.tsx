import type { ProviderSessionCache } from '@workspace/contracts'
import { formatContextTokens } from '@workspace/client-core/chat/context-usage'
import { formatChatTimestamp } from '@/features/chat/utils/formatters'

export function SessionCacheDetails({ cache }: { readonly cache: ProviderSessionCache }) {
  if (cache.turns.length === 0) return null
  let shareLabel = 'Cache write share unknown.'
  if (cache.writeShare !== null)
    shareLabel = `Cache writes: ${Math.round(cache.writeShare * 100)}% of reported cache reads and writes.`
  if (cache.readTokens === 0 && cache.writeTokens === 0)
    shareLabel = 'No reported cache reads or writes.'

  return (
    <section aria-label='Recent prompt cache' className='mt-2'>
      <div className='flex items-baseline justify-between gap-3'>
        <span className='text-muted-foreground'>Recent prompt cache</span>
        <span className='font-mono tabular-nums'>
          {cache.turns.length} {cache.turns.length === 1 ? 'turn' : 'turns'}
        </span>
      </div>
      <div className='text-muted-foreground mt-1.5 grid grid-cols-4 gap-2'>
        <span>Observed</span>
        <span className='text-right'>Read</span>
        <span className='text-right'>Written</span>
        <span className='text-right' title='Writes divided by reported cache reads plus writes'>
          Share
        </span>
      </div>
      <dl className='mt-1 flex flex-col gap-1'>
        {cache.turns.map((turn) => (
          <div className='grid grid-cols-4 gap-2 font-mono tabular-nums' key={turn.turnId}>
            <dt>
              <time
                dateTime={turn.recordedAt}
                title={`Turn ${turn.turnId} · ${turn.models.join(', ')} · Observed ${turn.recordedAt} · Requested ${turn.requestedAt ?? 'unknown'} · Started ${turn.startedAt ?? 'unknown'} · Completed ${turn.completedAt ?? 'unknown'}`}
              >
                {formatChatTimestamp(turn.recordedAt)}
              </time>
            </dt>
            <dd className='text-right'>
              {turn.readTokens === null ? 'Unknown' : formatContextTokens(turn.readTokens)}
            </dd>
            <dd className='text-right'>
              {turn.writeTokens === null ? 'Unknown' : formatContextTokens(turn.writeTokens)}
            </dd>
            <dd className='text-right'>
              {turn.writeShare === null ? '—' : `${Math.round(turn.writeShare * 100)}%`}
            </dd>
          </div>
        ))}
      </dl>
      <p className='text-muted-foreground mt-1.5 leading-snug'>{shareLabel}</p>
      <p className='text-muted-foreground mt-1 leading-snug'>
        Unknown counters have incomplete recorded data. Counts include auxiliary calls.
      </p>
    </section>
  )
}
