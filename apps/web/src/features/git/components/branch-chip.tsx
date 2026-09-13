import { useStatus } from '@/features/git/hooks'
import { aheadBehindLabel } from '@/features/git/utils/repository'

export function BranchChip({ rootPath }: { readonly rootPath: string }) {
  const status = useStatus(rootPath)
  const repository = status.data?.repository ?? null
  if (!repository) return null

  const label = aheadBehindLabel(repository)

  return (
    <span className='bg-muted text-muted-foreground text-2xs flex h-(--density-chip-height) min-w-0 items-center gap-1.5 rounded-full px-2 font-mono'>
      <span className='text-foreground min-w-0 truncate'>{repository.branch ?? 'HEAD'}</span>
      {label ? <span className='shrink-0 tabular-nums'>{label}</span> : null}
    </span>
  )
}
