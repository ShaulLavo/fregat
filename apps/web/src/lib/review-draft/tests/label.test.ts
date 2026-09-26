import { expect, test } from '../../../../test/fixtures'

import { reviewCommentLabel } from '@/lib/review-draft/utils/label'

test('a chip names a file range, a reply range or a plan range', () => {
  expect(
    reviewCommentLabel({
      kind: 'diff',
      newRange: { start: 10, end: 12 },
      oldRange: null,
      path: 'repo/src/app.ts',
    }),
  ).toBe('app.ts:10–12')
  expect(
    reviewCommentLabel({
      kind: 'message',
      lines: { end: 4, start: 2 },
      messageId: 'm-1',
      sessionId: 's-1',
    }),
  ).toBe('Reply lines 2–4')
  expect(
    reviewCommentLabel({ kind: 'plan', lines: { end: 1, start: 1 }, planId: 'p', sessionId: 's' }),
  ).toBe('Plan line 1')
})
