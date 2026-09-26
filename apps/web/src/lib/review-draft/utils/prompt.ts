import {
  escapeContextMarkup,
  unescapeContextMarkup,
} from '@workspace/client-core/chat/context-markup'
import * as v from 'valibot'

import type { ReviewComment, SentReviewComment } from '@/lib/review-draft/utils/types'

/**
 * The review travels as an XML-shaped block ahead of the typed text: the agent reads each quote
 * and comment, and the transcript reads the anchor back to link the comment to its source.
 * Escaping keeps quoted code from closing a tag it did not open.
 */
const BLOCK_OPEN = '<review_comments>'
const BLOCK_CLOSE = '</review_comments>'
const LEADING_BLOCK = /^<review_comments>\n([\s\S]*?)\n<\/review_comments>(?:\n\n|\n?$)/
const COMMENT = /<comment author="(agent|user)" anchor="([^"]*)">\n([\s\S]*?)\n<\/comment>/g
const SEPARATOR = '\n\n---\n\n'
const rangeSchema = v.object({ start: v.number(), end: v.number() })
const anchorSchema = v.variant('kind', [
  v.object({
    kind: v.literal('diff'),
    path: v.string(),
    oldRange: v.nullable(rangeSchema),
    newRange: v.nullable(rangeSchema),
    oldObjectId: v.optional(v.string()),
    newObjectId: v.optional(v.string()),
  }),
  v.object({ kind: v.literal('plan'), planId: v.string(), lines: rangeSchema }),
  v.object({
    kind: v.literal('message'),
    sessionId: v.string(),
    messageId: v.string(),
    lines: rangeSchema,
  }),
])
const anchorJsonSchema = v.pipe(v.string(), v.parseJson(), anchorSchema)

/** A comment as stored with a stashed or queued message; its destination is the composer's. */
export const sentReviewCommentSchema = v.object({
  anchor: anchorSchema,
  author: v.picklist(['agent', 'user']),
  body: v.string(),
  quote: v.string(),
})

/** The review as one block: each quoted excerpt, then what the reviewer said about it. */
export function reviewPrompt(comments: readonly ReviewComment[]): string {
  if (comments.length === 0) return ''
  const blocks = comments.map((comment) =>
    [
      `<comment author="${comment.author}" anchor="${escapeContextMarkup(JSON.stringify(comment.anchor))}">`,
      escapeContextMarkup(`${comment.quote}${SEPARATOR}${authored(comment)}`),
      '</comment>',
    ].join('\n'),
  )
  return [BLOCK_OPEN, ...blocks, BLOCK_CLOSE].join('\n')
}

/** The message text with the review in front of whatever the user typed. */
export function withReviewComments(text: string, comments: readonly ReviewComment[]) {
  const review = reviewPrompt(comments)
  if (!review) return text
  return text ? `${review}\n\n${text}` : review
}

/**
 * Splits a sent message back into its review comments and the typed text, so the transcript
 * shows chips that lead back to each source. A comment whose anchor no longer parses is dropped.
 */
export function extractReviewComments(text: string): {
  comments: SentReviewComment[]
  text: string
} {
  const match = LEADING_BLOCK.exec(text)
  if (!match) return { comments: [], text }

  const comments = [...(match[1] ?? '').matchAll(COMMENT)].flatMap((entry) => {
    const anchor = v.safeParse(anchorJsonSchema, unescapeContextMarkup(entry[2] ?? ''))
    if (!anchor.success) return []
    const content = unescapeContextMarkup(entry[3] ?? '')
    const split = content.lastIndexOf(SEPARATOR)
    const author = entry[1] === 'agent' ? ('agent' as const) : ('user' as const)
    return [
      {
        anchor: anchor.output,
        author,
        body: unauthored(split < 0 ? '' : content.slice(split + SEPARATOR.length), author),
        quote: split < 0 ? content : content.slice(0, split),
      },
    ]
  })
  return { comments, text: text.slice(match[0].length) }
}

/** A reviewing agent's finding says so; the user's own comments go as written. */
function authored(comment: Pick<ReviewComment, 'author' | 'body'>) {
  const body = comment.body.trim()
  return comment.author === 'agent' ? `Reviewer finding: ${body}` : body
}

function unauthored(body: string, author: SentReviewComment['author']) {
  return author === 'agent' ? body.replace(/^Reviewer finding: /, '') : body
}
