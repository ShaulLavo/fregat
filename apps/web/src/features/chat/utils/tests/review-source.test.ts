import { describe } from 'vitest'
import { expect, test } from '../../../../../test/fixtures'

import { blockQuoteLines, diffQuoteNewLines, linesMatch } from '@/features/chat/utils/review-source'
import { markdownQuote } from '@/features/chat/utils/plan-comment'

describe('review sources', () => {
  test('the new side of a quoted diff is its added and context lines', () => {
    const quote = [
      'About `src/app.ts`, new lines 2-3:',
      '',
      '```diff',
      '@@ -2,2 +2,2 @@',
      ' const a = 1',
      '-const b = 2',
      '+const b = 3',
      '```',
    ].join('\n')
    expect(diffQuoteNewLines(quote)).toEqual(['const a = 1', 'const b = 3'])
    expect(diffQuoteNewLines('no hunk here')).toBeNull()
  })

  test('a quoted reply reads back as its own lines, and only the same lines match', () => {
    const reply = 'first\nsecond\nthird'
    const quote = markdownQuote(reply, { end: 3, start: 2 }, 'your earlier reply')
    expect(quote.startsWith('About your earlier reply, lines 2–3:')).toBe(true)
    expect(linesMatch(reply, { end: 3, start: 2 }, blockQuoteLines(quote))).toBe(true)
    expect(linesMatch('first\nchanged\nthird', { end: 3, start: 2 }, blockQuoteLines(quote))).toBe(
      false,
    )
    expect(linesMatch('first', { end: 3, start: 2 }, blockQuoteLines(quote))).toBe(false)
  })
})
