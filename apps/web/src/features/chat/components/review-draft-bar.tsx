import { XIcon } from '@phosphor-icons/react'
import { Button } from '@workspace/ui/components/button'

import { removeReviewComments } from '@/lib/review-draft/state/store'
import { reviewCommentLabel } from '@/lib/review-draft/utils/label'
import type { ReviewComment } from '@/lib/review-draft/utils/types'

/** Review comments riding with the next message, each removable, all sent together. */
export function ReviewDraftBar({
  comments,
  disabled,
}: {
  readonly comments: readonly ReviewComment[]
  readonly disabled: boolean
}) {
  if (comments.length === 0) return null

  return (
    <div
      aria-label='Review comments'
      className='flex min-w-0 flex-col gap-(--density-gap-tight) px-(--density-control-padding-x) pb-(--density-section-gap)'
      role='group'
    >
      <div className='text-muted-foreground text-2xs flex items-center justify-between'>
        <span className='tabular-nums'>
          Review · {comments.length} {comments.length === 1 ? 'comment' : 'comments'}, sent with
          your message
        </span>
        <Button
          disabled={disabled}
          size='xs'
          type='button'
          variant='ghost'
          onClick={() => removeReviewComments(comments.map((comment) => comment.id))}
        >
          Discard
        </Button>
      </div>
      {comments.map((comment) => (
        <div
          className='flex min-w-0 items-center gap-(--density-gap-tight)'
          key={comment.id}
          title={`${comment.quote}\n\n${comment.body}`}
        >
          {comment.author === 'agent' ? (
            <span className='text-muted-foreground text-2xs shrink-0'>Agent</span>
          ) : null}
          <span className='bg-muted text-foreground text-2xs shrink-0 rounded-md px-1.5 py-0.5 font-mono tabular-nums'>
            {reviewCommentLabel(comment.anchor)}
          </span>
          <span className='min-w-0 flex-1 truncate text-xs'>{comment.body}</span>
          <Button
            aria-label={`Remove comment on ${reviewCommentLabel(comment.anchor)}`}
            className='text-muted-foreground'
            data-tooltip='Remove comment'
            disabled={disabled}
            focusableWhenDisabled
            size='icon-xs'
            type='button'
            variant='ghost'
            onClick={() => removeReviewComments([comment.id])}
          >
            <XIcon className='size-(--icon-size-sm)' />
          </Button>
        </div>
      ))}
    </div>
  )
}
