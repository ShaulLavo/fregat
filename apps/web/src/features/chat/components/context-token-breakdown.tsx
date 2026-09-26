import {
  formatContextTokens,
  type ContextTokenBreakdown as Breakdown,
} from '@workspace/client-core/chat/context-usage'

const ROWS = [
  { key: 'inputTokens', label: 'Input' },
  { key: 'cachedInputTokens', label: 'Cached input' },
  { key: 'cacheWriteTokens', label: 'Cache write' },
  { key: 'outputTokens', label: 'Output' },
  { key: 'reasoningOutputTokens', label: 'of which reasoning' },
] as const

/** The last turn by token kind. A kind the provider did not report is left out, never shown as zero. */
export function ContextTokenBreakdown({ breakdown }: { readonly breakdown: Breakdown }) {
  return (
    <dl className='mt-2 flex flex-col gap-1'>
      {ROWS.map(({ key, label }) => {
        const value = breakdown[key]
        if (value === null) return null

        return (
          <div className='flex items-baseline justify-between gap-3' key={key}>
            <dt
              className={
                key === 'reasoningOutputTokens'
                  ? 'text-muted-foreground pl-3'
                  : 'text-muted-foreground'
              }
            >
              {label}
            </dt>
            <dd className='tabular-nums'>{formatContextTokens(value)}</dd>
          </div>
        )
      })}
    </dl>
  )
}
