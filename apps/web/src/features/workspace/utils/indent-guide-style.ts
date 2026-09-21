import type { EditorTheme, EditorSyntaxThemeColor } from '@singapore-editor/core/rendering'

type GuideColor = {
  readonly color: EditorSyntaxThemeColor
  readonly fallback: string
  readonly weight: number
}

const GUIDE_COLORS = [
  { color: 'type', fallback: '#7dd3fc', weight: 34 },
  { color: 'keyword', fallback: '#6ee7b7', weight: 30 },
  { color: 'string', fallback: '#fde68a', weight: 28 },
  { color: 'number', fallback: '#c4b5fd', weight: 32 },
  { color: 'function', fallback: '#fecdd3', weight: 30 },
  { color: 'variableBuiltin', fallback: '#fdba74', weight: 30 },
] as const satisfies readonly GuideColor[]

export function fileTreeIndentGuideVariables(theme: EditorTheme): Record<string, string> {
  const variables: Record<string, string> = {}

  for (const [index, guide] of GUIDE_COLORS.entries()) {
    const color = theme.syntax?.[guide.color] ?? guide.fallback
    variables[`--trees-indent-guide-bg-${index}-override`] = transparentMix(color, guide.weight)
  }

  return variables
}

function transparentMix(color: string, weight: number): string {
  return `color-mix(in srgb, ${color} ${weight}%, transparent)`
}
