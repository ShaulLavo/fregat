import type { EditorTheme } from '@singapore-editor/core/rendering'
import { editorThemeToShikiTheme } from '@singapore-editor/core/shiki'
import type { CodeHighlighter } from '@workspace/markdown/providers/code-highlighter-context'
import { createShikiHighlighter } from '@workspace/markdown/utils/shiki-highlighter'
import type { ThemeRegistrationAny, TokensResult } from 'shiki/core'

export type CodeHighlighterColorMode = 'dark' | 'light'

type ThemeSlots = [ThemeRegistrationAny, ThemeRegistrationAny]

type TokenWithStyle = {
  content?: string
  htmlStyle?: Record<string, string | undefined>
}

const CSS_CUSTOM_PROPERTY_LANGUAGES = new Set(['astro', 'css', 'html', 'sass', 'scss', 'svelte'])

const FALLBACK_THEME_BY_COLOR_MODE = {
  dark: { background: '#1e1e1e', foreground: '#d4d4d4' },
  light: { background: '#ffffff', foreground: '#24292e' },
} satisfies Record<CodeHighlighterColorMode, { background: string; foreground: string }>

/**
 * The chat's highlighter: the editor's palette on the shared shiki, with the
 * token colours normalised the way the editor's own tokens are.
 */
export function createEditorCodeHighlighter({
  colorMode,
  editorTheme,
  registration,
  themeKey,
}: {
  readonly colorMode: CodeHighlighterColorMode
  readonly editorTheme: EditorTheme
  readonly registration: ThemeRegistrationAny
  readonly themeKey: string
}): CodeHighlighter {
  const themes = highlighterThemesForEditorTheme(editorTheme, colorMode, registration)
  const highlighter = createShikiHighlighter({ themeKey, themes })

  return {
    dispose: () => highlighter.dispose(),
    highlight(input, onResult) {
      const result = highlighter.highlight(input, (highlighted) =>
        onResult(normalizeTokenColors(highlighted, input.language, editorTheme)),
      )

      return result ? normalizeTokenColors(result, input.language, editorTheme) : null
    },
    themeKey,
  }
}

function highlighterThemesForEditorTheme(
  theme: EditorTheme,
  colorMode: CodeHighlighterColorMode,
  activeThemeRegistration?: ThemeRegistrationAny,
): ThemeSlots {
  return [
    themeForSlot(theme, colorMode, 'light', activeThemeRegistration),
    themeForSlot(theme, colorMode, 'dark', activeThemeRegistration),
  ]
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

function themeForSlot(
  theme: EditorTheme,
  colorMode: CodeHighlighterColorMode,
  shikiColorMode: CodeHighlighterColorMode,
  activeThemeRegistration?: ThemeRegistrationAny,
): ThemeRegistrationAny {
  // The active mode's slot renders through the real loaded VSCode theme; the
  // other mode stays synthetic, derived from the current EditorTheme.
  if (shikiColorMode === colorMode && activeThemeRegistration) return activeThemeRegistration

  return themeFromEditorTheme(theme, colorMode, shikiColorMode)
}

function themeFromEditorTheme(
  theme: EditorTheme,
  colorMode: CodeHighlighterColorMode,
  shikiColorMode: CodeHighlighterColorMode,
): ThemeRegistrationAny {
  const fallback = FALLBACK_THEME_BY_COLOR_MODE[colorMode]

  return editorThemeToShikiTheme(theme, {
    fallbackBackground: fallback.background,
    fallbackForeground: fallback.foreground,
    type: shikiColorMode,
  }) as ThemeRegistrationAny
}

function normalizeTokenColors(
  result: TokensResult,
  language: string,
  theme: EditorTheme,
): TokensResult {
  for (const line of result.tokens) {
    for (const token of line as TokenWithStyle[]) {
      normalizeTokenColor(token, language, theme)
    }
  }

  return result
}

function normalizeTokenColor(token: TokenWithStyle, language: string, theme: EditorTheme) {
  const activeColor = token.htmlStyle?.['--shiki-dark']
  if (activeColor && token.htmlStyle) token.htmlStyle.color = activeColor

  if (!shouldNormalizeCssCustomProperties(language)) return
  if (!isCssCustomPropertyDeclarationToken(token.content)) return

  const propertyColor = theme.syntax?.property
  if (!propertyColor) return

  token.htmlStyle ??= {}
  token.htmlStyle.color = propertyColor
  token.htmlStyle['--shiki-dark'] = propertyColor
}

function shouldNormalizeCssCustomProperties(language: string) {
  return CSS_CUSTOM_PROPERTY_LANGUAGES.has(language.toLowerCase())
}

function isCssCustomPropertyDeclarationToken(content: string | undefined) {
  return /^\s*--[\w-]+\s*:/u.test(content ?? '')
}
