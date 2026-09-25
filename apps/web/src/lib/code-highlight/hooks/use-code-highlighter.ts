import type { CodeHighlighter } from '@workspace/markdown/providers/code-highlighter-context'
import type { ThemeRegistrationAny } from 'shiki/core'

import { codeHighlighterForTheme } from '@/lib/code-highlight/state/highlighters'
import { editorThemeHighlightKey } from '@/lib/code-highlight/utils/theme'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'

/** The shared highlighter for the current code theme, or null until the theme has loaded. */
export function useCodeHighlighter(): CodeHighlighter | null {
  const { colorMode, definition, editorTheme, registration } = useEditorColorTheme()
  if (!registration) return null
  return codeHighlighterForTheme({
    colorMode,
    editorTheme,
    registration: registration as ThemeRegistrationAny,
    themeKey: editorThemeHighlightKey(editorTheme, colorMode, definition?.shikiName),
  })
}
