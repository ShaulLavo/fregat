export type TokenMatchKind = 'exact' | 'prefix' | 'boundary' | 'includes' | 'fuzzy'

export type TokenMatch = {
  kind: TokenMatchKind
  index: number
  span: number
}

export type TokenMatchOptions = {
  /** Characters a word may start after. */
  boundaryMarkers: string
  /** Shorter tokens must match literally. */
  minFuzzyLength: number
}

/** Both arguments are already normalized, and the token is never empty. */
export function matchToken(
  field: string,
  token: string,
  options: TokenMatchOptions,
): TokenMatch | null {
  const contiguous = contiguousMatch(field, token, options.boundaryMarkers)
  if (contiguous) return contiguous
  if (token.length < options.minFuzzyLength) return null

  return subsequenceMatch(field, token)
}

export function contiguousMatch(
  field: string,
  token: string,
  boundaryMarkers: string,
): TokenMatch | null {
  const first = field.indexOf(token)
  if (first === -1) return null

  const span = token.length
  if (first === 0) return { kind: field.length === span ? 'exact' : 'prefix', index: 0, span }

  const boundary = boundaryIndex(field, token, first, boundaryMarkers)
  if (boundary !== -1) return { kind: 'boundary', index: boundary, span }

  return { kind: 'includes', index: first, span }
}

/** Greedy leftmost subsequence; the gap total is `span - token.length`. */
export function subsequenceMatch(field: string, token: string): TokenMatch | null {
  let from = 0
  let first = -1
  let last = -1

  for (let tokenIndex = 0; tokenIndex < token.length; tokenIndex += 1) {
    const index = field.indexOf(token.charAt(tokenIndex), from)
    if (index === -1) return null

    if (first === -1) first = index
    last = index
    from = index + 1
  }

  return { kind: 'fuzzy', index: first, span: last - first + 1 }
}

export function startsWord(field: string, index: number, boundaryMarkers: string) {
  if (index <= 0) return true

  return boundaryMarkers.includes(field.charAt(index - 1))
}

// A mid-word first hit must not hide a later word-start hit: `research-search` for `search`.
function boundaryIndex(field: string, token: string, first: number, boundaryMarkers: string) {
  for (let index = first; index !== -1; index = field.indexOf(token, index + 1)) {
    if (startsWord(field, index, boundaryMarkers)) return index
  }

  return -1
}
