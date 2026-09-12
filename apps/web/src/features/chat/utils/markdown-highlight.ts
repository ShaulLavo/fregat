import type { HighlightResult } from '@streamdown/code'
import { fnv1a32 } from '@workspace/client-core/address/path-hash'

/** Rough per-token overhead: content string plus the style/attr objects around it. */
const TOKEN_OVERHEAD_BYTES = 96

/**
 * The cache key never holds the code itself — a hash plus the length keeps keys
 * small while making a collision require both a hash match and an equal length.
 */
export function markdownHighlightCacheKey({
  code,
  language,
  themeKey,
}: {
  readonly code: string
  readonly language: string
  readonly themeKey: string
}) {
  return `${themeKey}:${language}:${code.length}:${(fnv1a32(code) >>> 0).toString(36)}`
}

export function estimateHighlightBytes(result: HighlightResult) {
  let bytes = 0
  for (const line of result.tokens) {
    bytes += TOKEN_OVERHEAD_BYTES
    for (const token of line) {
      bytes += TOKEN_OVERHEAD_BYTES + token.content.length * 2
    }
  }

  return bytes
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
