import { expect, test } from 'vitest'

import { createWorkspaceSearchMatcher } from '../workspace-search-match'

test.each(['literal', 'regex'] as const)('%s matching respects its budget', (matchMode) => {
  const matcher = createWorkspaceSearchMatcher({ query: 'needle', matchMode, wholeWord: true })
  const line = 'needless needle needle needle'

  expect(matcher.lineMatches(line, 2)).toEqual([
    { start: 9, end: 15 },
    { start: 16, end: 22 },
  ])
  expect(matcher.lineMatches(line, 0)).toEqual([])
  expect(matcher.lineMatches(line)).toHaveLength(3)
})
