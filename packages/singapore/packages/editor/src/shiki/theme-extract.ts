import type { EditorTheme } from '../theme'
import {
  EDITOR_SHIKI_SYNTAX_SCOPE_MAPPINGS,
  type EditorShikiThemeColorMode,
  type EditorShikiThemeSettingLike,
} from './theme'

export type ShikiThemeLike = {
  readonly bg?: string
  readonly fg?: string
  readonly colors?: Readonly<Record<string, string | undefined>>
  readonly tokenColors?: readonly EditorShikiThemeSettingLike[]
  readonly settings?: readonly EditorShikiThemeSettingLike[]
  readonly type?: EditorShikiThemeColorMode
}

export function editorThemeFromShikiTheme(theme: ShikiThemeLike): EditorTheme {
  const backgroundColor = theme.bg ?? theme.colors?.['editor.background']
  const foregroundColor = theme.fg ?? theme.colors?.['editor.foreground']
  const syntax = editorSyntaxThemeFromShikiTheme(theme)

  return {
    // A theme that says which canvas it paints on has to keep saying it: the declared canvas is what
    // lets the extracted theme override the viewer's own preference for every colour it leaves to a
    // default, and those are the ones this extraction cannot fill in.
    ...(theme.type ? { type: theme.type } : {}),
    backgroundColor,
    foregroundColor,
    gutterBackgroundColor: theme.colors?.['editorGutter.background'] ?? backgroundColor,
    gutterForegroundColor: theme.colors?.['editorLineNumber.foreground'],
    caretColor: theme.colors?.['editorCursor.foreground'] ?? foregroundColor,
    minimapBackgroundColor: backgroundColor,
    ...(syntax ? { syntax } : {}),
  }
}

function editorSyntaxThemeFromShikiTheme(
  theme: ShikiThemeLike,
): NonNullable<EditorTheme['syntax']> | undefined {
  const syntax: NonNullable<EditorTheme['syntax']> = {}
  for (const mapping of EDITOR_SHIKI_SYNTAX_SCOPE_MAPPINGS) {
    const color = themeColorForScopes(theme, mapping.scopes)
    if (color !== undefined) syntax[mapping.key] = color
  }
  const bracketColor = theme.fg ?? theme.colors?.['editor.foreground']
  if (syntax.bracket === undefined && bracketColor !== undefined) syntax.bracket = bracketColor
  if (Object.keys(syntax).length === 0) return undefined
  return syntax
}

function themeColorForScopes(
  theme: ShikiThemeLike,
  targetScopes: readonly string[],
): string | undefined {
  const settings = shikiThemeSettings(theme)
  let bestMatch: ScopeColorMatch | null = null
  for (let index = 0; index < settings.length; index += 1) {
    const match = settingColorMatch(settings[index], targetScopes, index)
    if (!match) continue
    if (!isBetterScopeColorMatch(match, bestMatch)) continue

    bestMatch = match
  }
  return bestMatch?.color
}

type ScopeColorMatch = {
  readonly color: string
  readonly order: number
  readonly score: number
}

function shikiThemeSettings(theme: ShikiThemeLike): readonly EditorShikiThemeSettingLike[] {
  return theme.tokenColors ?? theme.settings ?? []
}

function settingColorMatch(
  setting: EditorShikiThemeSettingLike | undefined,
  targetScopes: readonly string[],
  order: number,
): ScopeColorMatch | null {
  const color = setting?.settings?.foreground
  if (!color) return null

  const score = settingScopeMatchScore(setting, targetScopes)
  if (score === 0) return null

  return { color, order, score }
}

function settingScopeMatchScore(
  setting: EditorShikiThemeSettingLike,
  targetScopes: readonly string[],
): number {
  let bestScore = 0
  const scopes = normalizedSettingScopes(setting.scope)
  for (const scope of scopes) {
    bestScore = Math.max(bestScore, scopeMatchScore(scope, targetScopes))
  }
  return bestScore
}

function normalizedSettingScopes(scope: string | readonly string[] | undefined): readonly string[] {
  if (scope === undefined) return []
  if (typeof scope === 'string') return splitScopeList(scope)
  return scope.flatMap(splitScopeList)
}

function splitScopeList(scope: string): string[] {
  return scope
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

function scopeMatchScore(scope: string, targetScopes: readonly string[]): number {
  let bestScore = 0
  for (let index = 0; index < targetScopes.length; index += 1) {
    bestScore = Math.max(bestScore, scopeTargetMatchScore(scope, targetScopes[index], index))
  }
  return bestScore
}

function scopeTargetMatchScore(scope: string, target: string, targetIndex: number): number {
  const targetPriority = Math.max(0, 20 - targetIndex)
  if (scope === target) return 300 + targetPriority + scopeDepth(scope)
  if (target.startsWith(`${scope}.`)) return 100 + targetPriority + scopeDepth(scope)
  return 0
}

function scopeDepth(scope: string): number {
  return scope.split('.').length
}

function isBetterScopeColorMatch(
  candidate: ScopeColorMatch,
  current: ScopeColorMatch | null,
): boolean {
  if (!current) return true
  if (candidate.score !== current.score) return candidate.score > current.score
  return candidate.order > current.order
}
