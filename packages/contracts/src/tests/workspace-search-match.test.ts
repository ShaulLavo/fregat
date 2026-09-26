import { expect, test } from 'vitest'

import {
  createWorkspaceSearchMatcher,
  isWholeWordMatch,
  workspaceSearchGlobPath,
} from '../workspace-search-match'

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

test.each([
  ['a space on both sides', 'x foo y', 2, 5, true],
  ['an underscore after', 'foo_bar', 0, 3, false],
  ['a digit before', '9foo', 1, 4, false],
  ['a non-ASCII letter before', 'éfoo', 1, 4, false],
  ['an astral letter before', '𝐀foo', 2, 5, false],
  ['an astral letter after', 'foo𝐀', 0, 3, false],
  ['an emoji before', '😀foo', 2, 5, true],
] as const)('whole word with %s: %s', (_label, text, start, end, expected) => {
  expect(isWholeWordMatch(text, start, end, true)).toBe(expected)
  expect(isWholeWordMatch(text, start, end, false)).toBe(true)
})

test.each([
  ['', 'src/a.ts', 'src/a.ts'],
  ['src', 'src', ''],
  ['src', 'src/a.ts', 'a.ts'],
  ['/repo', '/repo/src/a.ts', 'src/a.ts'],
  ['src', 'srcx/a.ts', 'srcx/a.ts'],
  ['src', 'lib/a.ts', 'lib/a.ts'],
  ['src/a.ts', 'src', 'src'],
])('glob path under root %j for %j is %j', (rootPath, path, expected) => {
  expect(workspaceSearchGlobPath(rootPath, path)).toBe(expected)
})
