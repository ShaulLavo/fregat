import { expect, test } from 'vitest'
import { sanitizeSessionTitle } from '../title-normalization'

test.each([
  ['  "Fix   worker crashes"\nExtra explanation', 'Fix worker crashes'],
  ['{"title":"Review queue ownership"}', 'Review queue ownership'],
  [' "`" ', 'New chat'],
  ['New thread', 'New chat'],
  ['', 'New chat'],
  ['x'.repeat(121), `${'x'.repeat(117)}…`],
])('normalizes provider title %s', (input, expected) => {
  expect(sanitizeSessionTitle(input)).toBe(expected)
})
