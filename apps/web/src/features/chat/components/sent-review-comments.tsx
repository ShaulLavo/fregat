import { SentReviewCommentList } from '@/features/chat/components/sent-review-comment-list'
import type { SessionId } from '@workspace/contracts'
import type { SentReviewComment } from '@workspace/client-core/chat/review-comments'

/** The review comments a message carried, each leading back to what it quoted. */
export function SentReviewComments({
  comments,
  sessionId,
}: {
  readonly comments: readonly SentReviewComment[]
  /** The session the message was sent in. */
  readonly sessionId: SessionId
}) {
  if (comments.length === 0) return null

  return <SentReviewCommentList comments={comments} sessionId={sessionId} />
}
