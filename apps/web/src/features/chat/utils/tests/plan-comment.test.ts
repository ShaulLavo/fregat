import { expect, test } from '../../../../../test/fixtures'

import { planCommentQuote } from '@/features/chat/utils/plan-comment'

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
