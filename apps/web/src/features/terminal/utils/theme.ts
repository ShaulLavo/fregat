import type { TerminalColor, TerminalTheme } from 'ghostty-webgpu'
import type { Rgb } from '@workspace/contracts'
import type { TerminalColors } from '@workspace/client-core/themes/palette'

/** The ghostty theme for a resolved palette, over the session's current one. */
export function terminalThemeFor(colors: TerminalColors, current: TerminalTheme): TerminalTheme {
  const palette = current.palette.slice()
  for (const [index, color] of colors.ansi.entries()) palette[index] = terminalColor(color)

  return {
    ...current,
    // ghostty paints the cell behind the cursor in this slot; the pane's content
    // well is the real background, so the terminal never paints one of its own.
    background: terminalColor(colors.cursorAccent),
    cursor: terminalColor(colors.cursor),
    foreground: terminalColor(colors.foreground),
    selectionBackground: terminalColor(colors.selection),
    selectionForeground: terminalColor(colors.selectionForeground),
    palette,
  }
}

function terminalColor(color: Rgb): TerminalColor {
  return { r: color.r, g: color.g, b: color.b }
}
