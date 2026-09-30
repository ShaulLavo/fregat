import { codeHighlighterForTheme } from '@/lib/code-highlight/state/code-highlighters'
import {
  codeHighlightTheme,
  editorThemeHighlightKey,
} from '@/lib/code-highlight/utils/code-highlighter-theme'
import { useEditorColorTheme } from '@/lib/editor-theme/hooks/use-editor-color-theme'

/** The fence highlighter for the active editor theme, so rendered code matches the editor. */
export function useCodeHighlighter() {
  const { colorMode, definition, editorTheme, registration } = useEditorColorTheme()
  const themeKey = editorThemeHighlightKey(editorTheme, colorMode, definition?.shikiName)
  if (!registration || !definition) return null

  return codeHighlighterForTheme(
    codeHighlightTheme({ colorMode, registration, shikiName: definition.shikiName }),
    themeKey,
  )
}
