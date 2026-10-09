import { parseColor, toHex } from '@workspace/contracts'
import type { ResolvedPalette } from '@workspace/contracts/themes/palette-rendering'

export type MermaidTheme = {
  readonly colorMode: 'dark' | 'light'
  readonly fontFamily: string
  readonly variables: Readonly<Record<string, string>>
}

export function diagramTheme(palette: ResolvedPalette, fontFamily: string): MermaidTheme {
  const color = (role: string) => {
    const value = palette.cssVariables[role]!
    const parsed = parseColor(value)
    return parsed ? toHex(parsed) : value
  }
  const foreground = color('--foreground')
  const background = color('--background-solid')
  const muted = color('--muted-solid')
  const primary = color('--primary')
  return {
    colorMode: palette.mode,
    fontFamily,
    variables: {
      background,
      fontFamily,
      primaryColor: muted,
      primaryTextColor: foreground,
      primaryBorderColor: primary,
      secondaryColor: background,
      secondaryTextColor: foreground,
      secondaryBorderColor: primary,
      tertiaryColor: muted,
      tertiaryTextColor: foreground,
      lineColor: foreground,
      textColor: foreground,
      mainBkg: muted,
      nodeBorder: primary,
      edgeLabelBackground: background,
      actorBkg: muted,
      actorBorder: primary,
      actorTextColor: foreground,
      signalColor: foreground,
      signalTextColor: foreground,
      labelBoxBkgColor: muted,
      labelBoxBorderColor: primary,
      labelTextColor: foreground,
      noteBkgColor: muted,
      noteBorderColor: primary,
      noteTextColor: foreground,
    },
  }
}
