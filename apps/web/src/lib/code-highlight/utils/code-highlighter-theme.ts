import type { EditorTheme } from '@singapore-editor/core/rendering'
import type { VscodeThemeRegistration } from '@singapore-editor/core/shiki'
import type { HighlightTheme } from '@singapore-editor/highlighting'

export type CodeHighlighterColorMode = 'dark' | 'light'

/** Rendered code paints with the imported theme the editor shows. */
export function codeHighlightTheme({
  colorMode,
  registration,
  shikiName,
}: {
  readonly colorMode: CodeHighlighterColorMode
  readonly registration: VscodeThemeRegistration
  readonly shikiName: string
}): HighlightTheme {
  return { format: 'vscode', definition: { ...registration, name: shikiName, type: colorMode } }
}

/**
 * Identity of the palette a highlight was produced with. Colour mode alone is
 * not enough: two themes can share a mode, and cached tokens carry baked colours.
 */
export function editorThemeHighlightKey(
  theme: EditorTheme,
  colorMode: CodeHighlighterColorMode,
  shikiThemeName?: string,
) {
  const syntax = theme.syntax

  return [
    colorMode,
    shikiThemeName ?? '',
    theme.backgroundColor ?? '',
    theme.foregroundColor ?? '',
    syntax?.keyword ?? '',
    syntax?.string ?? '',
    syntax?.property ?? '',
  ].join('|')
}
