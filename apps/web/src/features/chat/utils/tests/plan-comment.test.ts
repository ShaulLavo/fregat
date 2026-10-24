import { expect, test } from '../../../../../test/fixtures'

import {
  markdownQuote,
  planCommentQuote,
  planSourceLineOffset,
} from '@/features/chat/utils/plan-comment'

const plan = [
  '# Plan',
  '',
  '## Steps',
  '',
  '1. Add the **route**',
  '2. Wire the client',
  '3. Ship',
].join('\n')

test('quotes the plan lines under where they are', () => {
  expect(planCommentQuote(plan, { start: 5, end: 6 })).toBe(
    [
      'About the proposed plan, lines 5–6:',
      '',
      '> 1. Add the **route**',
      '> 2. Wire the client',
    ].join('\n'),
  )
})

test.each(['\n', '\r\n', '\r'])(
  'quotes an original source line after the %j separator',
  (separator) => {
    const original = `first${separator}https://example.test/a`
    expect(planCommentQuote(original, { start: 2, end: 2 })).toBe(
      'About the proposed plan, line 2:\n\n> https://example.test/a',
    )
  },
)

test('quotes mixed original line endings without changing Markdown or UTF16 content', () => {
  const original = 'prefix\r\n`one\rtwo` &amp; 🧑‍💻 e\u0301 \ud83e\nlast'
  expect(planCommentQuote(original, { start: 2, end: 3 })).toBe(
    'About the proposed plan, lines 2–3:\n\n> `one\n> two` &amp; 🧑‍💻 e\u0301 \ud83e',
  )
})

test('counts a CRLF pair as one source line when quoting a message', () => {
  expect(markdownQuote('first\r\nsecond\rthird\nfourth', { start: 2, end: 4 }, 'the message')).toBe(
    'About the message, lines 2–4:\n\n> second\n> third\n> fourth',
  )
})

test.each(['\n', '\r\n', '\r'])(
  'counts stripped plan lines using the original %j separator',
  (separator) => {
    const displayed = ['one', 'two'].join(separator)
    const original = ['# Title', '', displayed, '   '].join(separator)
    expect(planSourceLineOffset(original, displayed)).toBe(2)
  },
)

test('counts mixed line endings in stripped plan headings and displayed content', () => {
  expect(planSourceLineOffset('# Title\r\n\r\none\rtwo\nthree\r\n', 'one\rtwo\nthree')).toBe(2)
})
