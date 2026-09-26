import * as v from 'valibot'

import { escapeContextMarkup, unescapeContextMarkup } from './context-markup'

const rangeSchema = v.object({ start: v.number(), end: v.number() })

/** Where a review comment points, kept so the transcript can lead back to it. */
const reviewCommentAnchorSchema = v.variant('kind', [
  v.object({
    kind: v.literal('diff'),
    /** The server path of the file, as the git routes name it. */
    path: v.string(),
    oldRange: v.nullable(rangeSchema),
    newRange: v.nullable(rangeSchema),
    oldObjectId: v.optional(v.string()),
    newObjectId: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal('plan'),
    planId: v.string(),
    /** The session that proposed the plan. */
    sessionId: v.string(),
    /** One-based lines of the plan's markdown. */
    lines: rangeSchema,
  }),
  v.object({
    /** A quote from an earlier assistant reply. */
    kind: v.literal('message'),
    sessionId: v.string(),
    messageId: v.string(),
    /** One-based lines of the reply's markdown. */
    lines: rangeSchema,
  }),
])

/** A review comment as a message carries it: its source, author, quoted lines and remark. */
export const sentReviewCommentSchema = v.object({
  anchor: reviewCommentAnchorSchema,
  author: v.picklist(['agent', 'user']),
  body: v.string(),
  quote: v.string(),
})

export type ReviewCommentAnchor = v.InferOutput<typeof reviewCommentAnchorSchema>
export type SentReviewComment = v.InferOutput<typeof sentReviewCommentSchema>

/**
 * The review travels as an XML-shaped block ahead of the typed text. Every field is escaped,
 * so no quote, body or typed text can open or close a tag the serializer did not write.
 */
const BLOCK_OPEN = '<review_comments>'
const BLOCK_CLOSE = '</review_comments>'
const LEADING_BLOCK = /^<review_comments>\n([\s\S]*?)\n<\/review_comments>(?:\n\n|\n?$)/
const COMMENT =
  /<comment author="(agent|user)" anchor="([^"]*)">\n<quote>\n([\s\S]*?)\n<\/quote>\n<body>\n([\s\S]*?)\n<\/body>\n<\/comment>/g
const anchorJsonSchema = v.pipe(v.string(), v.parseJson(), reviewCommentAnchorSchema)

/**
 * The message text with the review in front of the typed text. Typed text that itself opens with
 * the block's tag gets an empty review ahead of it, so the reader never takes it for comments.
 */
export function prependReviewComments(text: string, comments: readonly SentReviewComment[]) {
  if (comments.length === 0 && !text.startsWith(BLOCK_OPEN)) return text
  const review = [BLOCK_OPEN, comments.map(serializeComment).join('\n'), BLOCK_CLOSE].join('\n')
  return text ? `${review}\n\n${text}` : review
}

/**
 * Splits a sent message back into its review comments and the typed text. A comment whose
 * anchor no longer parses is dropped.
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
    return [
      {
        anchor: anchor.output,
        author: entry[1] === 'agent' ? ('agent' as const) : ('user' as const),
        quote: unescapeContextMarkup(entry[3] ?? ''),
        body: unescapeContextMarkup(entry[4] ?? ''),
      },
    ]
  })
  return { comments, text: text.slice(match[0].length) }
}

function serializeComment(comment: SentReviewComment) {
  return [
    `<comment author="${comment.author}" anchor="${escapeContextMarkup(JSON.stringify(comment.anchor))}">`,
    '<quote>',
    escapeContextMarkup(comment.quote),
    '</quote>',
    '<body>',
    escapeContextMarkup(comment.body),
    '</body>',
    '</comment>',
  ].join('\n')
}
