import { createContext } from 'react'
import type { TokensResult } from 'shiki/core'

export type HighlightInput = {
  readonly code: string
  readonly language: string
}

/**
 * The seam between the renderer and syntax highlighting. The renderer never
 * constructs a highlighter; whoever owns the editor theme builds one and
 * provides it here.
 */
export type CodeHighlighter = {
  readonly dispose: () => void
  /** Returns tokens synchronously when the grammar is loaded, otherwise calls back. */
  readonly highlight: (
    input: HighlightInput,
    onResult: (result: TokensResult) => void,
  ) => TokensResult | null
  /** Identity of the active palette; part of every highlight cache key. */
  readonly themeKey: string
}

export const CodeHighlighterContext = createContext<CodeHighlighter | null>(null)
