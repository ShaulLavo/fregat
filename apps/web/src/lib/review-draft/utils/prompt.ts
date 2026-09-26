import type { ReviewComment } from '@/lib/review-draft/utils/types'

/** The review as one message: each quoted excerpt followed by what the reviewer said about it. */
export function reviewPrompt(comments: readonly ReviewComment[]): string {
  if (comments.length === 0) return ''
  const blocks = comments.map((comment, index) =>
    [`${index + 1}. ${comment.quote}`, '', authored(comment)].join('\n'),
  )
  return ['Review comments:', '', ...blocks.flatMap((block) => [block, ''])].join('\n').trim()
}

/** The message text with the review in front of whatever the user typed. */
export function withReviewComments(text: string, comments: readonly ReviewComment[]) {
  const review = reviewPrompt(comments)
  if (!review) return text
  return text ? `${review}\n\n${text}` : review
}

/** A reviewing agent's finding says so; the user's own comments go as written. */
function authored(comment: ReviewComment) {
  const body = comment.body.trim()
  return comment.author === 'agent' ? `Reviewer finding: ${body}` : body
}
