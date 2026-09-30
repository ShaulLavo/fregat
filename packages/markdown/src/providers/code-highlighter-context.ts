import { createContext } from 'react'
import type { HighlightResult } from '@singapore-editor/highlighting'

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
  /** Returns tokens synchronously when it already has them, otherwise calls back once. */
  readonly highlight: (
    input: HighlightInput,
    onResult: (result: HighlightResult) => void,
  ) => HighlightResult | null
  /** Identity of the active palette; part of every highlight cache key. */
  readonly themeKey: string
}

export const CodeHighlighterContext = createContext<CodeHighlighter | null>(null)
