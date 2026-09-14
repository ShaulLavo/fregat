import type { GitHistoryRef } from '@workspace/contracts'
import { GitBranchIcon, TagIcon } from '@phosphor-icons/react'
import { cn } from '@workspace/ui/lib/utils'
import { HistoryGraph } from '@/features/git/components/history-graph'
import type { HistoryRow as GraphRow } from '@/features/git/utils/history-layout'
import { historyCommitTitle, historyRefLabel } from '@/features/git/utils/history-presentation'

export function HistoryRow({
  row,
  refs,
  graphWidth,
  selected,
  expanded,
  onSelect,
  id,
}: {
  id: string
  row: GraphRow
  refs: readonly GitHistoryRef[]
  graphWidth: number
  selected: boolean
  expanded: boolean
  onSelect: (id: string) => void
}) {
  const head = refs.some((ref) => ref.kind === 'head')
  return (
    <div
      role='option'
      id={id}
      aria-selected={selected}
      aria-label={row.commit.subject}
      data-history-commit={row.commit.id}
      className={cn(
        'flex h-(--density-row-height) cursor-pointer items-center gap-2 pr-(--density-row-padding-x) text-xs hover:bg-row-hover active:bg-row-active',
        selected && 'bg-row-selected',
      )}
      title={historyCommitTitle(row.commit, refs)}
      onClick={() => onSelect(row.commit.id)}
    >
      <HistoryGraph row={row} width={graphWidth} head={head} />
      <div className='flex min-w-0 flex-1 items-center gap-1.5'>
        {refs.length > 0 ? (
          <span className='flex max-w-1/2 shrink-0 items-center gap-1 overflow-hidden'>
            {refs.map((ref) => (
              <span
                key={ref.name}
                className={cn(
                  'inline-flex min-w-0 items-center gap-0.5 rounded-md bg-muted px-1 text-3xs font-medium',
                  ref.kind === 'head' && 'text-info',
                )}
              >
                {ref.kind === 'tag' ? <TagIcon className='size-3 shrink-0' /> : null}
                {ref.kind === 'branch' || ref.kind === 'remote' ? (
                  <GitBranchIcon className='size-3 shrink-0' />
                ) : null}
                <span className='truncate' title={ref.name}>
                  {historyRefLabel(ref)}
                </span>
              </span>
            ))}
          </span>
        ) : null}
        <span className='truncate' title={row.commit.subject}>
          {row.commit.subject || 'Untitled commit'}
        </span>
      </div>
      {expanded ? (
        <>
          <span
            className='text-muted-foreground w-28 shrink-0 truncate'
            title={`${row.commit.author} <${row.commit.authorEmail}>`}
          >
            {row.commit.author}
          </span>
          <span className='text-muted-foreground text-2xs w-20 shrink-0 text-right tabular-nums'>
            {new Date(row.commit.timestamp).toLocaleDateString()}
          </span>
          <span className='text-muted-foreground text-2xs w-16 shrink-0 text-right font-mono'>
            {row.commit.id.slice(0, 7)}
          </span>
        </>
      ) : null}
    </div>
  )
}
