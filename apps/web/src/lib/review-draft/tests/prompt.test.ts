import type { EnvironmentId } from '@workspace/contracts'
import { expect, test } from '../../../../test/fixtures'

import { reviewCommentLabel } from '@/lib/review-draft/utils/label'
import {
  extractReviewComments,
  reviewPrompt,
  withReviewComments,
} from '@/lib/review-draft/utils/prompt'
import type { ReviewComment } from '@/lib/review-draft/utils/types'

const comment = (body: string, start: number, end: number): ReviewComment => ({
  anchor: {
    kind: 'diff',
    newRange: { start, end },
    oldRange: null,
    path: 'src/app.ts',
  },
  author: 'user',
  body,
  createdAt: '2026-09-25T00:00:00.000Z',
  destination: { environmentId: 'environment-1' as EnvironmentId, rootPath: 'repo' },
  id: `comment-${start}`,
  quote: `About \`src/app.ts\`, new lines ${start}-${end}:\n\n\`\`\`diff\n+ if (a < b && c) return "x"\n\`\`\``,
})

test('each comment quotes its excerpt and says what the reviewer wrote, ahead of the typed text', () => {
  const comments = [comment('Name this better', 3, 3), comment('This can throw', 10, 12)]
  const prompt = reviewPrompt(comments)

  expect(prompt.startsWith('<review_comments>\n<comment author="user" anchor="')).toBe(true)
  expect(prompt).toContain('Name this better')
  expect(prompt).toContain('if (a &lt; b &amp;&amp; c) return &quot;x&quot;')
  expect(withReviewComments('Please fix these', comments)).toMatch(
    /<\/review_comments>\n\nPlease fix these$/,
  )
  expect(withReviewComments('Only text', [])).toBe('Only text')
  expect(reviewCommentLabel(comments[1]!.anchor)).toBe('app.ts:10–12')
})

test('a sent message reads back as its comments, anchors intact, and the typed text', () => {
  const agent: ReviewComment = {
    ...comment('Check the bound', 5, 6),
    anchor: { kind: 'message', lines: { end: 4, start: 2 }, messageId: 'm-1', sessionId: 's-1' },
    author: 'agent',
  }
  const comments = [comment('Name this better', 3, 3), agent]
  const read = extractReviewComments(withReviewComments('Please fix these', comments))

  expect(read.text).toBe('Please fix these')
  expect(read.comments).toEqual(
    comments.map(({ anchor, author, body, quote }) => ({ anchor, author, body, quote })),
  )
  expect(extractReviewComments('No review here')).toEqual({ comments: [], text: 'No review here' })
  expect(reviewCommentLabel(agent.anchor)).toBe('Reply lines 2–4')
})

test('a comment whose anchor does not parse is left out rather than pointed somewhere else', () => {
  const text =
    '<review_comments>\n<comment author="user" anchor="{}">\nquote\n</comment>\n</review_comments>\n\nHi'

  expect(extractReviewComments(text)).toEqual({ comments: [], text: 'Hi' })
})
