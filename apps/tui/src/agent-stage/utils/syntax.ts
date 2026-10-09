import { convertThemeToStyles, parseColor, type StyleDefinitionInput } from '@opentui/core'
import type { Theme } from '@/theme/utils/theme'

export function promptStyles(theme: Theme) {
  return {
    'prompt-part': { fg: theme.info, bg: theme.accent, bold: true },
    'prompt-reference': { fg: theme.info, underline: true },
  }
}

export function markdownStyles(theme: Theme) {
  return convertThemeToStyles([
    { scope: ['default', 'markup', 'text'], style: { foreground: theme.foreground } },
    { scope: ['markup.heading', 'keyword'], style: { foreground: theme.primary, bold: true } },
    { scope: ['markup.bold'], style: { foreground: theme.foreground, bold: true } },
    { scope: ['markup.italic'], style: { foreground: theme.foreground, italic: true } },
    { scope: ['string', 'markup.link'], style: { foreground: theme.info } },
    { scope: ['comment', 'punctuation'], style: { foreground: theme.mutedForeground } },
  ])
}

export function syntaxKey(styles: Readonly<Record<string, StyleDefinitionInput>>) {
  return JSON.stringify(
    Object.entries(styles).map(([name, { fg, bg, ...attributes }]) => [
      name,
      {
        ...attributes,
        fg: fg ? Array.from(parseColor(fg).buffer) : null,
        bg: bg ? Array.from(parseColor(bg).buffer) : null,
      },
    ]),
  )
}
