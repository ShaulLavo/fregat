import { minimatch } from 'minimatch'

import type { WorkspaceSearchQuery } from './workspace-search'

export type WorkspaceSearchTextMatch = {
  end: number
  start: number
}

export type WorkspaceSearchMatcher = {
  lineMatches: (line: string, limit?: number) => WorkspaceSearchTextMatch[]
  pathMatches: (path: string) => boolean
}

export function createWorkspaceSearchMatcher(
  query: Pick<
    WorkspaceSearchQuery,
    'caseSensitive' | 'excludeGlobs' | 'includeGlobs' | 'matchMode' | 'query' | 'wholeWord'
  >,
): WorkspaceSearchMatcher {
  const lineMatcher = createLineMatcher(query)
  const pathMatcher = createPathMatcher(query)

  return {
    lineMatches: lineMatcher,
    pathMatches: pathMatcher,
  }
}

export function workspaceSearchGlobPatterns(value: readonly string[] | string | undefined) {
  if (value === undefined) return []
  if (typeof value === 'string') return normalizedGlobPatterns([value])

  return normalizedGlobPatterns(value)
}

/** `path` relative to `rootPath` for glob matching; a path outside the root passes through. */
export function workspaceSearchGlobPath(rootPath: string, path: string) {
  if (!rootPath) return path
  if (path === rootPath) return ''

  const prefix = `${rootPath}/`
  if (!path.startsWith(prefix)) return path

  return path.slice(prefix.length)
}

function normalizedGlobPatterns(values: readonly string[]) {
  const patterns: string[] = []
  for (const value of values) {
    for (const pattern of splitGlobPatterns(value)) {
      const trimmed = pattern.trim()
      if (!trimmed) continue
      patterns.push(trimmed)
    }
  }

  return patterns
}

function splitGlobPatterns(text: string) {
  const patterns: string[] = []
  let patternStart = 0
  let braceDepth = 0
  let escaped = false

  for (const match of text.matchAll(/./gs)) {
    const index = match.index
    const character = match[0]
    if (escaped) {
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (character === '{') {
      braceDepth += 1
      continue
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1)
      continue
    }

    if (character !== ',' || braceDepth > 0) continue
    patterns.push(text.slice(patternStart, index))
    patternStart = index + 1
  }

  patterns.push(text.slice(patternStart))
  return patterns
}

function createLineMatcher(
  query: Pick<WorkspaceSearchQuery, 'caseSensitive' | 'matchMode' | 'query' | 'wholeWord'>,
) {
  if (query.matchMode === 'regex') return createRegexLineMatcher(query)

  return createLiteralLineMatcher(query)
}

function createLiteralLineMatcher(
  query: Pick<WorkspaceSearchQuery, 'caseSensitive' | 'query' | 'wholeWord'>,
) {
  const needle = query.caseSensitive ? query.query : query.query.toLocaleLowerCase()

  return (line: string, limit = Infinity) => literalLineMatches(line, needle, query, limit)
}

function literalLineMatches(
  line: string,
  needle: string,
  query: Pick<WorkspaceSearchQuery, 'caseSensitive' | 'query' | 'wholeWord'>,
  limit: number,
) {
  const matches: WorkspaceSearchTextMatch[] = []
  if (!needle || limit <= 0) return matches

  const haystack = query.caseSensitive ? line : line.toLocaleLowerCase()
  let index = haystack.indexOf(needle)

  while (index >= 0) {
    const end = index + query.query.length
    if (isWholeWordMatch(line, index, end, query.wholeWord)) {
      matches.push({ end, start: index })
    }
    if (matches.length >= limit) return matches
    index = haystack.indexOf(needle, end)
  }

  return matches
}

function createRegexLineMatcher(
  query: Pick<WorkspaceSearchQuery, 'caseSensitive' | 'query' | 'wholeWord'>,
) {
  const regex = compiledRegex(query)
  if (!regex) return () => []

  return (line: string, limit = Infinity) => regexLineMatches(line, regex, limit, query.wholeWord)
}

function compiledRegex(query: Pick<WorkspaceSearchQuery, 'caseSensitive' | 'query'>) {
  try {
    const flags = query.caseSensitive ? 'gu' : 'giu'
    return new RegExp(query.query, flags)
  } catch {
    return null
  }
}

function regexLineMatches(line: string, regex: RegExp, limit: number, wholeWord?: boolean) {
  const matches: WorkspaceSearchTextMatch[] = []
  if (limit <= 0) return matches
  regex.lastIndex = 0

  while (true) {
    const match = regex.exec(line)
    if (!match) return matches

    const start = match.index
    const end = start + match[0].length
    if (end > start && isWholeWordMatch(line, start, end, wholeWord)) {
      matches.push({ end, start })
    }
    if (matches.length >= limit) return matches
    if (end > start) continue
    advancePastEmptyMatch(regex, line)
  }
}

function advancePastEmptyMatch(regex: RegExp, line: string) {
  const current = regex.lastIndex
  if (current > line.length) return

  const codePoint = line.codePointAt(current)
  regex.lastIndex = current + (codePoint && codePoint > 0xffff ? 2 : 1)
}

export function isWholeWordMatch(text: string, start: number, end: number, wholeWord?: boolean) {
  if (!wholeWord) return true

  return isWordBoundary(text, start, 'left') && isWordBoundary(text, end, 'right')
}

function isWordBoundary(text: string, offset: number, side: 'left' | 'right') {
  if (side === 'left') return !isWordCodePointBefore(text, offset)

  return !isWordCodePointAt(text, offset)
}

function isWordCodePointBefore(text: string, offset: number) {
  if (offset <= 0) return false

  const start = previousCodePointStart(text, offset)
  return start !== null && isWordCodePointAt(text, start)
}

function previousCodePointStart(text: string, offset: number) {
  if (offset <= 0) return null

  const previous = offset - 1
  const codeUnit = text.charCodeAt(previous)
  const beforePrevious = previous - 1
  if (codeUnit < 0xdc00 || codeUnit > 0xdfff) return previous
  if (beforePrevious < 0) return previous

  const previousCodeUnit = text.charCodeAt(beforePrevious)
  if (previousCodeUnit < 0xd800 || previousCodeUnit > 0xdbff) return previous

  return beforePrevious
}

function isWordCodePointAt(text: string, offset: number) {
  const codePoint = text.codePointAt(offset)
  if (codePoint === undefined) return false

  return /^[\p{L}\p{N}_]$/u.test(String.fromCodePoint(codePoint))
}

function createPathMatcher(query: Pick<WorkspaceSearchQuery, 'excludeGlobs' | 'includeGlobs'>) {
  const includeGlobs = workspaceSearchGlobPatterns(query.includeGlobs)
  const excludeGlobs = workspaceSearchGlobPatterns(query.excludeGlobs)

  return (path: string) => pathMatchesGlobs(path, includeGlobs, excludeGlobs)
}

function pathMatchesGlobs(
  path: string,
  includeGlobs: readonly string[],
  excludeGlobs: readonly string[],
) {
  if (excludeGlobs.some((pattern) => matchesGlob(path, pattern))) return false
  if (includeGlobs.length === 0) return true

  return includeGlobs.some((pattern) => matchesGlob(path, pattern))
}

function matchesGlob(path: string, pattern: string) {
  return minimatch(path, pattern, {
    dot: true,
    matchBase: !pattern.includes('/'),
    nonegate: true,
  })
}
