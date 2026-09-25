import { TickerText } from '@/components/ticker-text'
import { useStatus } from '@/features/git/hooks/use-status'
import { aheadBehindLabel } from '@/features/git/utils/repository'

export function BranchChip({ rootPath }: { readonly rootPath: string }) {
  const status = useStatus(rootPath)
  const repository = status.data?.repository ?? null
  if (!repository) return null

  const label = aheadBehindLabel(repository)
  const branch = repository.branch ?? 'HEAD'
  const commit = repository.commit ? ` @ ${repository.commit.slice(0, 7)}` : ''

  return (
    <span
      className='bg-muted text-muted-foreground text-2xs flex h-(--density-chip-height) min-w-0 items-center gap-1.5 rounded-full px-2 font-mono'
      title={`${branch}${commit}`}
    >
      <span className='text-foreground min-w-0 truncate'>{branch}</span>
      {label ? (
        <span className='shrink-0'>
          <TickerText text={label} />
        </span>
      ) : null}
    </span>
  )
}
