import type { HighlightResult } from '@singapore-editor/highlighting'

/** Rough per-token overhead: offsets plus the style object around them. */
const TOKEN_OVERHEAD_BYTES = 96

/**
 * The cache key never holds the code itself — a hash plus the length keeps keys
 * small while making a collision require both a hash match and an equal length.
 */
export function highlightCacheKey({
  code,
  language,
  themeKey,
}: {
  readonly code: string
  readonly language: string
  readonly themeKey: string
}) {
  return `${themeKey}:${language}:${code.length}:${fnv1a32(code).toString(36)}`
}

export function estimateHighlightBytes(result: HighlightResult) {
  return result.tokens.length * TOKEN_OVERHEAD_BYTES
}

/**
 * Streaming only ever appends, so highlighting the whole buffer would re-tokenize
 * a half-typed trailing line on every frame — colouring identifiers that are not
 * finished yet and minting a cache entry per keystroke. Complete lines are stable;
 * the tail renders as plain text until its newline arrives.
 */
export function completedCodePrefix(code: string) {
  const lastNewline = code.lastIndexOf('\n')
  if (lastNewline < 0) return { highlightable: '', trailing: code }

  return { highlightable: code.slice(0, lastNewline), trailing: code.slice(lastNewline + 1) }
}

function fnv1a32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }

  return hash >>> 0
}
