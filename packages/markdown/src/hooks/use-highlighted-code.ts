import { use, useEffect, useState } from 'react'
import type { TokensResult } from 'shiki/core'

import { CodeHighlighterContext } from '../providers/code-highlighter-context'
import { highlightCache } from '../state/highlight-cache'
import { estimateHighlightBytes, highlightCacheKey } from '../utils/highlight'

type HighlightState = {
  readonly key: string
  readonly result: TokensResult
}

/**
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
}): TokensResult | null {
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
    const accept = (result: TokensResult) => {
      if (cacheable) highlightCache.set(key, result, estimateHighlightBytes(result))
      if (!active) return

      setHighlighted({ key, result })
    }

    // A loaded grammar answers synchronously and never calls back; an unloaded
    // one returns null now and calls back once the grammar is in.
    const immediate = highlighter.highlight({ code, language }, accept)
    if (immediate) accept(immediate)

    return () => {
      active = false
    }
  }, [cacheable, code, highlighter, key, language])

  if (cached) return cached
  if (highlighted?.key === key) return highlighted.result

  return null
}
