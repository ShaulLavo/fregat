import type { ComposerDestination } from '@/lib/composer-attach/providers/context'

type LineRange = { readonly start: number; readonly end: number }

/** Where a comment points, kept so it can be found again after the diff moves. */
export type ReviewCommentAnchor =
  | {
      readonly kind: 'diff'
      readonly path: string
      readonly oldRange: LineRange | null
      readonly newRange: LineRange | null
      readonly oldObjectId?: string
      readonly newObjectId?: string
    }
  | {
      readonly kind: 'plan'
      readonly planId: string
      /** One-based lines of the plan's markdown. */
      readonly lines: LineRange
    }
  | {
      /** A quote from an earlier assistant reply in the same session. */
      readonly kind: 'message'
      readonly sessionId: string
      readonly messageId: string
      /** One-based lines of the reply's markdown. */
      readonly lines: LineRange
    }

export type ReviewComment = {
  readonly id: string
  readonly anchor: ReviewCommentAnchor
  readonly author: 'agent' | 'user'
  readonly body: string
  readonly createdAt: string
  readonly destination: ComposerDestination
  /** The quoted lines as the agent will read them: a fenced excerpt under its location. */
  readonly quote: string
}

/** A comment as it went out with a message: what the transcript reads back from its text. */
export type SentReviewComment = Pick<ReviewComment, 'anchor' | 'author' | 'body' | 'quote'>
