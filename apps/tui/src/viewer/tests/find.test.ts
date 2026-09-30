import { findMatches, nextMatch, clampPosition } from '@/viewer/utils/find'
import { createViewerSyntax } from '@/viewer/state/syntax'
import { viewerLineRuns } from '@/viewer/utils/line-runs'
import { resolveTheme } from '@/theme/utils/theme'
import { test, expect } from '../../../test/fixtures'

test('find produces LSP UTF-16 columns and wraps both directions', () => {
  const matches = findMatches('😀 const Alpha = 1\nalpha Alpha', 'alpha')
  expect(matches).toEqual([
    { line: 0, character: 9 },
    { line: 1, character: 0 },
    { line: 1, character: 6 },
  ])
  expect(nextMatch(matches, { line: 1, character: 6 }, 1)).toEqual(matches[0])
  expect(nextMatch(matches, { line: 0, character: 9 }, -1)).toEqual(matches[2])
  expect(clampPosition(['hi'], { line: 100, character: 100 })).toEqual({ line: 0, character: 2 })
})

test('the viewer leaves a line over the tokenization limit as plain text', async () => {
  const syntax = createViewerSyntax()
  const source = 'const a = 1\nconst longer = 2'
  try {
    const [first, second] = await syntax.tokenize('sample.ts', source, 'dark', 11)
    expect(first!.length).toBeGreaterThan(1)
    expect(second!.map((token) => token.content)).toEqual(['const longer = 2'])
  } finally {
    syntax.dispose()
  }
})

test('actual Shiki tokenizer colors TypeScript without changing source text', async () => {
  const syntax = createViewerSyntax()
  const source = 'const answer: number = 42;\n// unicode 😀'
  try {
    const tokens = await syntax.tokenize('sample.ts', source, 'dark', 20_000)
    expect(tokens.map((line) => line.map((token) => token.content).join('')).join('\n')).toBe(
      source,
    )
    expect(
      new Set(tokens.flat().flatMap((token) => ('color' in token ? [token.color] : []))).size,
    ).toBeGreaterThan(2)
  } finally {
    syntax.dispose()
  }
})

test('find painting spans syntax boundaries and keeps UTF-16 cursor positions intact', () => {
  const theme = resolveTheme('dark', 'dark', false)
  const text = '😀 value[0]'
  const runs = viewerLineRuns({
    text,
    theme,
    cursor: 0,
    query: '[0]',
    tokens: [{ content: '😀 value' }, { content: '[' }, { content: '0]' }],
  })
  expect(runs.map((run) => run.text).join('')).toBe(text)
  expect(runs[0]).toMatchObject({ text: '😀', fg: theme.primaryForeground, bg: theme.primary })
  expect(
    runs
      .filter((run) => run.bg === theme.primary)
      .map((run) => run.text)
      .join(''),
  ).toBe('😀[0]')
})
