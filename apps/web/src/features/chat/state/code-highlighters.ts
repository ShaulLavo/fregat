import type { EditorTheme } from '@singapore-editor/core/rendering'
import type { CodeHighlighter } from '@workspace/markdown/providers/code-highlighter-context'
import type { ThemeRegistrationAny } from 'shiki/core'

import {
  createEditorCodeHighlighter,
  type CodeHighlighterColorMode,
} from '@/features/chat/utils/code-highlighter-theme'

// One highlighter per palette, shared by every message: a highlighter owns
// its loaded grammars, so one per message would compile TypeScript once per
// bubble. The theme key already encodes the palette's identity.
const highlighters = new Map<string, CodeHighlighter>()

export function codeHighlighterForTheme(options: {
  readonly colorMode: CodeHighlighterColorMode
  readonly editorTheme: EditorTheme
  readonly registration: ThemeRegistrationAny
  readonly themeKey: string
}): CodeHighlighter {
  const existing = highlighters.get(options.themeKey)
  if (existing) return existing

  const created = createEditorCodeHighlighter(options)
  highlighters.set(options.themeKey, created)

  return created
}

if (import.meta.hot)
  import.meta.hot.dispose(() => {
    for (const highlighter of highlighters.values()) highlighter.dispose()
    highlighters.clear()
  })
