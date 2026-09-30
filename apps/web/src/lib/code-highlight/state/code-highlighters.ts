import type { HighlightTheme } from '@singapore-editor/highlighting'
import type { CodeHighlighter } from '@workspace/markdown/providers/code-highlighter-context'

import { log } from '@/lib/client-logging'
import { highlightingService } from '@/lib/highlighting/state/service'

// One adapter per palette, shared by every message; the markdown cache keys on `themeKey`.
const highlighters = new Map<string, CodeHighlighter>()

export function codeHighlighterForTheme(theme: HighlightTheme, themeKey: string): CodeHighlighter {
  const existing = highlighters.get(themeKey)
  if (existing) return existing

  const created = createCodeHighlighter(theme, themeKey)
  highlighters.set(themeKey, created)
  return created
}

// Fences answer from the markdown cache when warm; the worker answers the rest asynchronously.
function createCodeHighlighter(theme: HighlightTheme, themeKey: string): CodeHighlighter {
  const lifetime = new AbortController()
  return {
    dispose: () => lifetime.abort(),
    highlight({ code, language }, onResult) {
      highlightingService()
        .highlight(code, { language, theme, signal: lifetime.signal })
        .then(onResult, (error: unknown) => {
          if (lifetime.signal.aborted) return
          // The fence keeps its plain text.
          log.warn({ action: 'code-highlight.failed', area: 'markdown', language, error })
        })
      return null
    },
    themeKey,
  }
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const highlighter of highlighters.values()) highlighter.dispose()
    highlighters.clear()
  })
