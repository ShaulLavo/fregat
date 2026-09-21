import type { Terminal, TerminalCursorStyle } from 'ghostty-webgpu'
import type { TerminalColors } from '@workspace/client-core/themes/palette'
import { terminalThemeFor } from '@/features/terminal/utils/theme'

type TerminalCursorOptions = {
  cursorBlink: boolean
  cursorStyle: TerminalCursorStyle
}

// Focus owns cursor shape; the setting owns blinking.
const FOCUSED_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'block'
export const UNFOCUSED_TERMINAL_CURSOR_STYLE: TerminalCursorStyle = 'outline'

export function terminalCursorOptions(
  focused: boolean,
  cursorBlink: boolean,
): TerminalCursorOptions {
  return {
    // Scoped to a focused terminal, per the setting's own description: an
    // unfocused cursor is a static outline whatever the preference says.
    cursorBlink: focused && cursorBlink,
    cursorStyle: focused ? FOCUSED_TERMINAL_CURSOR_STYLE : UNFOCUSED_TERMINAL_CURSOR_STYLE,
  }
}

export type TerminalAppearance = {
  readonly cursorBlink: boolean
  readonly fontSize: number
}

/** Pushes live appearance settings without rebuilding the terminal. */
export function applyTerminalAppearance(terminal: Terminal | null, appearance: TerminalAppearance) {
  if (!terminal) return

  terminal.setFont({ size: appearance.fontSize })
  terminal.setCursor({ blink: appearance.cursorBlink })
}

export function applyTerminalCursorOptions(
  terminal: Terminal | null,
  options: TerminalCursorOptions,
) {
  if (!terminal) return

  terminal.setCursor({ blink: options.cursorBlink, style: options.cursorStyle })
}

export function applyTerminalTheme(terminal: Terminal | null, colors: TerminalColors) {
  if (!terminal) return
  terminal.setTheme(terminalThemeFor(colors, terminal.appearance.theme))
}
