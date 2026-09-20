import { describe, expect, it } from 'vitest'

import { matchToken } from '../token-match'

const options = { boundaryMarkers: ' -_/', minFuzzyLength: 3 }

describe('matchToken', () => {
  it('classifies a token by the strongest tier it reaches', () => {
    expect(matchToken('search', 'search', options)?.kind).toBe('exact')
    expect(matchToken('search-result', 'search', options)?.kind).toBe('prefix')
    expect(matchToken('file-search', 'search', options)).toEqual({
      kind: 'boundary',
      index: 5,
      span: 6,
    })
    expect(matchToken('research', 'search', options)?.kind).toBe('includes')
    expect(matchToken('s-e-arch', 'search', options)).toEqual({ kind: 'fuzzy', index: 0, span: 8 })
  })

  it('finds a word-start hit behind a mid-word one', () => {
    expect(matchToken('research-search', 'search', options)).toEqual({
      kind: 'boundary',
      index: 9,
      span: 6,
    })
  })

  it('only treats the configured markers as word starts', () => {
    expect(matchToken('a.search', 'search', options)?.kind).toBe('includes')
    expect(matchToken('a.search', 'search', { ...options, boundaryMarkers: '.' })?.kind).toBe(
      'boundary',
    )
  })

  it('keeps tokens below the fuzzy minimum literal', () => {
    expect(matchToken('alpha-beta', 'ab', options)).toBeNull()
    expect(matchToken('alpha-beta', 'ab', { ...options, minFuzzyLength: 1 })?.kind).toBe('fuzzy')
  })

  it('never matches an empty field', () => {
    expect(matchToken('', 'a', options)).toBeNull()
  })
})
