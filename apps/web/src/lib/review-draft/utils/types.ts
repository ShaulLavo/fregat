import type { SentReviewComment } from '@workspace/client-core/chat/review-comments'

import type { ComposerDestination } from '@/lib/composer-attach/providers/context'

/** A comment waiting in a composer's review draft for the next message. */
export type ReviewComment = SentReviewComment & {
  readonly id: string
  readonly createdAt: string
  readonly destination: ComposerDestination
}
