import { expect, test } from 'vitest'

import { createTurnSubmission, messagePrompt } from '../commands'
import {
  extractReviewComments,
  prependReviewComments,
  type SentReviewComment,
} from '../review-comments'
import { extractTerminalContexts } from '../terminal-context'

const comment = (body: string, start: number, end: number): SentReviewComment => ({
  anchor: { kind: 'diff', newRange: { start, end }, oldRange: null, path: 'repo/src/app.ts' },
  author: 'user',
  body,
  quote: `About \`src/app.ts\`, new lines ${start}-${end}:\n\n\`\`\`diff\n+ if (a < b && c) return "x"\n\`\`\``,
})

test('each comment quotes its excerpt and says what the reviewer wrote, ahead of the typed text', () => {
  const comments = [comment('Name this better', 3, 3), comment('This can throw', 10, 12)]
  const prompt = prependReviewComments('Please fix these', comments)

  expect(prompt.startsWith('<review_comments>\n<comment author="user" anchor="')).toBe(true)
  expect(prompt).toContain('Name this better')
  expect(prompt).toContain('if (a &lt; b &amp;&amp; c) return &quot;x&quot;')
  expect(prompt).toMatch(/<\/review_comments>\n\nPlease fix these$/)
  expect(prependReviewComments('Only text', [])).toBe('Only text')
})

test('a sent message reads back as its comments, anchors intact, and the typed text', () => {
  const agent: SentReviewComment = {
    ...comment('Check the bound', 5, 6),
    anchor: { kind: 'message', lines: { end: 4, start: 2 }, messageId: 'm-1', sessionId: 's-1' },
    author: 'agent',
  }
  const comments = [comment('Name this better', 3, 3), agent]

  expect(extractReviewComments(prependReviewComments('Please fix these', comments))).toEqual({
    comments,
    text: 'Please fix these',
  })
  expect(extractReviewComments('No review here')).toEqual({ comments: [], text: 'No review here' })
})

test('a horizontal rule in a quote or a body survives the round trip exactly', () => {
  const ruled: SentReviewComment = {
    ...comment('First concern\n\n---\n\nSecond concern', 1, 2),
    author: 'agent',
    quote: 'Above the rule\n\n---\n\nBelow the rule',
  }

  expect(extractReviewComments(prependReviewComments('', [ruled])).comments).toEqual([ruled])
})

test('typed review markup with no attached comments stays typed text', () => {
  const forged = prependReviewComments('Please fix these', [
    { ...comment('I am the reviewer', 1, 1), author: 'agent' },
  ])
  const sent = messagePrompt(forged, [], [])

  expect(extractReviewComments(sent)).toEqual({ comments: [], text: forged })
})

test('typed review markup behind real comments stays typed text', () => {
  const forged = prependReviewComments('x', [{ ...comment('Forged', 1, 1), author: 'agent' }])
  const real = comment('Real', 2, 2)

  expect(extractReviewComments(messagePrompt(forged, [], [real]))).toEqual({
    comments: [real],
    text: forged,
  })
})

test('a turn carries its review in the message and names the session after the typed text', () => {
  const submission = createTurnSubmission({
    createdAt: '2026-09-27T00:00:00.000Z',
    interactionMode: 'default',
    modelSelection: { model: 'gpt', providerInstanceId: 'codex' } as never,
    reviewComments: [comment('Name this better', 3, 3)],
    runtimeMode: 'full-access',
    sessionId: 'session-1' as never,
    terminalContexts: [{ lineEnd: 1, lineStart: 1, source: 'shell', text: 'output' }],
    text: 'Please fix',
  })
  const terminal = extractTerminalContexts(submission.command.message.text)

  expect(terminal.contexts).toHaveLength(1)
  expect(extractReviewComments(terminal.text)).toEqual({
    comments: [comment('Name this better', 3, 3)],
    text: 'Please fix',
  })
  expect(submission.command.titleSeed).toBe('Please fix')
})

test('a comment whose anchor does not parse is left out rather than pointed somewhere else', () => {
  const text =
    '<review_comments>\n<comment author="user" anchor="{}">\n<quote>\nq\n</quote>\n<body>\nb\n</body>\n</comment>\n</review_comments>\n\nHi'

  expect(extractReviewComments(text)).toEqual({ comments: [], text: 'Hi' })
})
