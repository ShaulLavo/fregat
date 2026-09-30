import { use, useEffect, useState } from 'react'
import type { HighlightResult } from '@singapore-editor/highlighting'

import { CodeHighlighterContext } from '../providers/code-highlighter-context'
import { highlightCache } from '../state/highlight-cache'
import { estimateHighlightBytes, highlightCacheKey } from '../utils/highlight'

type HighlightState = {
  readonly key: string
  readonly code: string
  readonly result: HighlightResult
}

/** Tokens and the exact text they cover, which may be a prefix of the text on screen. */
export type HighlightedText = {
  readonly code: string
  readonly result: HighlightResult
}

/**
 * Streaming only appends, so while the worker highlights a longer prefix the last answer still
 * covers the start of the text and keeps painting; the new lines stay plain until it replies.
 *
 * `cacheable` is false while a fence is still streaming: those token arrays are
 * superseded by the next chunk, so caching them would fill the budget with
 * garbage and evict the finished blocks the user scrolls back to.
 */
export function useHighlightedCode({
  cacheable,
  code,
  language,
}: {
  readonly cacheable: boolean
  readonly code: string
  readonly language: string
}): HighlightedText | null {
  const highlighter = use(CodeHighlighterContext)
  const [highlighted, setHighlighted] = useState<HighlightState | null>(null)
  const key = highlighter
    ? highlightCacheKey({ code, language, themeKey: highlighter.themeKey })
    : ''
  const cached = cacheable && code.length > 0 ? highlightCache.get(key) : null

  useEffect(() => {
    if (!highlighter) return
    if (code.length === 0) return
    if (cacheable && highlightCache.get(key)) return

    let active = true
    const accept = (result: HighlightResult) => {
      if (cacheable) highlightCache.set(key, result, estimateHighlightBytes(result))
      if (!active) return

      setHighlighted({ key, code, result })
    }

    // A highlighter that already holds the answer returns it and never calls back; otherwise it
    // returns null now and calls back once the worker replies.
    const immediate = highlighter.highlight({ code, language }, accept)
    if (immediate) accept(immediate)

    return () => {
      active = false
    }
  }, [cacheable, code, highlighter, key, language])

  if (cached) return { code, result: cached }
  if (!highlighted) return null
  if (highlighted.key === key || code.startsWith(highlighted.code)) return highlighted

  return null
}
