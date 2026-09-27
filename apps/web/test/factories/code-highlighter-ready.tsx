import { useEffect } from 'react'

import { useCodeHighlighter } from '@/lib/code-highlight/hooks/use-code-highlighter'

/** Reports when the provider's real theme, engine and grammar can highlight code. */
export function CodeHighlighterReady({
  language,
  onReady,
}: {
  readonly language: string
  readonly onReady: () => void
}) {
  const highlighter = useCodeHighlighter()
  useEffect(() => {
    if (!highlighter) return
    let active = true
    const ready = () => {
      if (active) onReady()
    }
    if (highlighter.highlight({ code: '', language }, ready)) ready()
    return () => {
      active = false
    }
  }, [highlighter, language, onReady])
  return null
}
