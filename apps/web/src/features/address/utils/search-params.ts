// Search URLs carry effective filters; hidden glob drafts and replacement text stay local.
export type AddressableSearch = {
  readonly caseSensitive?: boolean
  readonly excludeGlobText?: string
  readonly includeGlobText?: string
  readonly matchMode?: string
  readonly query?: string
  readonly wholeWord?: boolean
}

/** Structural on purpose: the live store and the cached record both satisfy it. */
export type SearchBufferFacts = {
  readonly caseSensitive: boolean
  readonly excludeGlobText: string
  readonly filtersVisible: boolean
  readonly includeGlobText: string
  readonly matchMode: string
  readonly query: string
  readonly wholeWord: boolean
}

export function searchParamsFor(buffer: SearchBufferFacts | null) {
  if (!buffer) return null

  const params: Record<string, string> = {}
  if (buffer.query) params.q = buffer.query
  if (buffer.matchMode && buffer.matchMode !== 'literal') params.m = buffer.matchMode
  if (buffer.caseSensitive) params.case = '1'
  if (buffer.wholeWord) params.word = '1'
  if (buffer.filtersVisible && buffer.includeGlobText) params.in = buffer.includeGlobText
  if (buffer.filtersVisible && buffer.excludeGlobText) params.x = buffer.excludeGlobText

  return Object.keys(params).length ? params : null
}

const MATCH_MODES = new Set(['literal', 'regex', 'fuzzy'])

export function searchStateFor(
  params: Readonly<Record<string, string>> | null,
): AddressableSearch | null {
  if (!params) return null

  return {
    caseSensitive: searchFlag(params.case),
    excludeGlobText: params.x,
    includeGlobText: params.in,
    // A bogus mode used to reach the search request unvalidated and fail every query
    // for the workspace, then persist into its cached buffer.
    matchMode: MATCH_MODES.has(params.m ?? '') ? params.m : undefined,
    query: params.q,
    wholeWord: searchFlag(params.word),
  }
}

function searchFlag(value: string | undefined) {
  if (value === '1') return true
  if (value === '0') return false
  return undefined
}
