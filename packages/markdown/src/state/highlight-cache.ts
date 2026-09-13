import type { TokensResult } from 'shiki/core'

import { ByteBoundedLru } from '../utils/byte-bounded-lru'

/**
 * Shared across every renderer: the same block is highlighted again every
 * time a timeline scrolls it back into view, and identical snippets repeat
 * across turns. Bounded in bytes first, because a diff-heavy block is worth
 * thousands of one-line snippets.
 */
const MAX_HIGHLIGHT_ENTRIES = 300
const MAX_HIGHLIGHT_BYTES = 24 * 1024 * 1024

export const highlightCache = new ByteBoundedLru<TokensResult>(
  MAX_HIGHLIGHT_ENTRIES,
  MAX_HIGHLIGHT_BYTES,
)
