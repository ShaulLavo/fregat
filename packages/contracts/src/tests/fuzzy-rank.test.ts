import { describe, expect, it } from 'vitest'

import { compareFuzzyRankedTargets, fuzzyRankScore } from '../fuzzy-rank'

describe('fuzzy ranking', () => {
  it('prefers exact and prefix filename matches over looser matches', () => {
    const query = 'search'
    const paths = ['src/workspace-search.ts', 'src/search-result.ts', 'src/search.ts']

    const ranked = paths.toSorted((left, right) =>
      compareFuzzyRankedTargets(rankTarget(left), rankTarget(right), query),
    )

    expect(ranked).toEqual(['src/search.ts', 'src/search-result.ts', 'src/workspace-search.ts'])
  })

  it('prefers filename matches over path-only matches', () => {
    const filenameScore = fuzzyRankScore(rankTarget('src/search.ts'), 'search')
    const pathScore = fuzzyRankScore(rankTarget('search/index.ts'), 'search')

    expect(filenameScore).toBeGreaterThan(pathScore)
  })

  it('uses path ordering as a stable final tie-breaker', () => {
    const query = 'search'
    const ranked = ['b/search.ts', 'a/search.ts'].toSorted((left, right) =>
      compareFuzzyRankedTargets(rankTarget(left), rankTarget(right), query),
    )

    expect(ranked).toEqual(['a/search.ts', 'b/search.ts'])
  })

  it('does not let one fuzzy path piece span path segments', () => {
    expect(
      fuzzyRankScore(rankTarget('packages/editor-core/src/public/rendering.ts'), 'binding'),
    ).toBe(0)
    expect(
      fuzzyRankScore(
        rankTarget('apps/web/src/features/git/hooks/use-commit-pending.ts'),
        'binding',
      ),
    ).toBe(0)
  })

  it('keeps filename binding matches ahead of weak path matches', () => {
    const query = 'binding'
    const paths = [
      'packages/editor-core/src/public/rendering.ts',
      'apps/web/src/features/git/hooks/use-commit-pending.ts',
      'apps/web/src/keymap/default-bindings.ts',
      'apps/web/src/keymap/active-bindings.ts',
    ]

    const ranked = paths.toSorted((left, right) =>
      compareFuzzyRankedTargets(rankTarget(left), rankTarget(right), query),
    )

    expect(ranked.slice(0, 2)).toEqual([
      'apps/web/src/keymap/active-bindings.ts',
      'apps/web/src/keymap/default-bindings.ts',
    ])
  })

  it('ranks a word-start hit behind a mid-word hit as a word match', () => {
    const wordStart = fuzzyRankScore(rankTarget('src/research-search.ts'), 'search')
    const midWord = fuzzyRankScore(rankTarget('src/research-results.ts'), 'search')

    expect(wordStart).toBeGreaterThan(midWord)
  })

  it('still supports contiguous slash path queries', () => {
    expect(fuzzyRankScore(rankTarget('src/app.ts'), 'src/app')).toBeGreaterThan(0)
  })
})

function rankTarget(path: string) {
  return {
    label: path.split('/').at(-1) ?? path,
    path,
  }
}
