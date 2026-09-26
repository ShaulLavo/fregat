import { ArrowSquareOutIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { useOpenReviewSource } from '@/features/chat/hooks/use-open-review-source'
import { reviewCommentLabel } from '@/lib/review-draft/utils/label'
import type { SentReviewComment } from '@/lib/review-draft/utils/types'

/** Chips for a message's review comments; each opens the source it quoted. */
export function SentReviewCommentList({
  comments,
}: {
  readonly comments: readonly SentReviewComment[]
}) {
  const open = useOpenReviewSource()

  return (
    <div aria-label='Review comments' className='mb-2 flex min-w-0 flex-col gap-1' role='group'>
      {comments.map((comment, index) => {
        const label = reviewCommentLabel(comment.anchor)
        return (
          <div
            className='flex min-w-0 items-center gap-(--density-gap-tight)'
            data-sent-review-comment={label}
            key={`${label}:${index}`}
            title={`${comment.quote}\n\n${comment.body}`}
          >
            <Button
              aria-label={`Open ${label}`}
              data-scroll-anchor-ignore
              onClick={() => open.mutate(comment)}
              size='xs'
              type='button'
              variant='secondary'
            >
              <ArrowSquareOutIcon data-icon='inline-start' />
              <span className='font-mono tabular-nums'>{label}</span>
            </Button>
            {comment.author === 'agent' ? (
              <span className='text-muted-foreground text-2xs shrink-0'>Agent</span>
            ) : null}
            {comment.body ? (
              <span className='min-w-0 flex-1 truncate text-xs'>{comment.body}</span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
