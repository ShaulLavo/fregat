import { SentReviewCommentList } from '@/features/chat/components/sent-review-comment-list'
import type { SentReviewComment } from '@/lib/review-draft/utils/types'

/** The review comments a message carried, each leading back to what it quoted. */
export function SentReviewComments({
  comments,
}: {
  readonly comments: readonly SentReviewComment[]
}) {
  if (comments.length === 0) return null

  return <SentReviewCommentList comments={comments} />
}
