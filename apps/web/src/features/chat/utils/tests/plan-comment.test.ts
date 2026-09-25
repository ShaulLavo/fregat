import { expect, test } from '../../../../../test/fixtures'

import { planCommentQuote, planSelectionLines } from '@/features/chat/utils/plan-comment'

const plan = [
  '# Plan',
  '',
  '## Steps',
  '',
  '1. Add the **route**',
  '2. Wire the client',
  '3. Ship',
].join('\n')

test('finds the source lines a rendered selection came from, markdown syntax aside', () => {
  expect(planSelectionLines(plan, 'Wire the client')).toEqual({ start: 6, end: 6 })
  expect(planSelectionLines(plan, 'route\nWire the client\nShip')).toEqual({ start: 5, end: 7 })
  expect(planSelectionLines(plan, 'Not in the plan')).toBeNull()
})

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
