import type { ThemeRegistrationAny } from 'shiki/core'

import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'
import { codeHighlighterForTheme } from '@/features/chat/state/code-highlighters'
import { editorThemeHighlightKey } from '@/features/chat/utils/code-highlighter-theme'

/** The Shiki highlighter for the editor theme, shared by transcript code and tool input. */
export function useChatCodeHighlighter() {
  const { colorMode, definition, editorTheme, registration } = useEditorColorTheme()
  const themeKey = editorThemeHighlightKey(editorTheme, colorMode, definition?.shikiName)
  if (!registration) return null

  return codeHighlighterForTheme({
    colorMode,
    editorTheme,
    registration: registration as ThemeRegistrationAny,
    themeKey,
  })
}
