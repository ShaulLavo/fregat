import { formatCompactDiffCount } from '@/features/chat/utils/changed-files-presentation'

export function ChatDiffStatLabel({
  additions,
  deletions,
  showParentheses = false,
}: {
  additions: number
  deletions: number
  showParentheses?: boolean
}) {
  return (
    <>
      {showParentheses ? <span className='text-muted-foreground'>(</span> : null}
      {/* The compact digits are decoration; the exact counts live in the name. */}
      <span aria-label={`${additions} additions, ${deletions} deletions`} role='group'>
        <span aria-hidden='true' className='text-diff-added tabular-nums'>
          +{formatCompactDiffCount(additions)}
        </span>
        <span aria-hidden='true' className='text-muted-foreground mx-0.5'>
          /
        </span>
        <span aria-hidden='true' className='text-diff-removed tabular-nums'>
          -{formatCompactDiffCount(deletions)}
        </span>
      </span>
      {showParentheses ? <span className='text-muted-foreground'>)</span> : null}
    </>
  )
}
