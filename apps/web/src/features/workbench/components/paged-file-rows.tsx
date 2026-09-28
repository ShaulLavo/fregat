import type { PagedWindow } from '@singapore-editor/paged'

export function PagedFileRows({ rows }: Pick<PagedWindow, 'rows'>) {
  return (
    <div
      aria-label='Read-only file contents'
      className='min-w-max p-(--density-section-padding) font-mono text-xs'
    >
      {rows.map((row) => (
        <div key={row.line} className='flex gap-(--density-control-gap)'>
          <span
            aria-hidden='true'
            className='text-muted-foreground w-16 shrink-0 text-right tabular-nums select-none'
          >
            {row.line + 1}
          </span>
          <span className='text-foreground whitespace-pre'>
            {row.text.replace(/\r$/u, '') || '\u200b'}
          </span>
        </div>
      ))}
    </div>
  )
}
