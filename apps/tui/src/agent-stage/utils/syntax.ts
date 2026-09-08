import { SyntaxStyle } from '@opentui/core'
import type { Theme } from '@/theme/utils/theme'

export function promptSyntax(theme: Theme) {
  return SyntaxStyle.fromStyles({
    'prompt-part': { fg: theme.info, bg: theme.accent, bold: true },
    'prompt-reference': { fg: theme.info, underline: true },
  })
}

export function markdownSyntax(theme: Theme) {
  return SyntaxStyle.fromTheme([
    { scope: ['default', 'markup', 'text'], style: { foreground: theme.foreground } },
    { scope: ['markup.heading', 'keyword'], style: { foreground: theme.primary, bold: true } },
    { scope: ['markup.bold'], style: { foreground: theme.foreground, bold: true } },
    { scope: ['markup.italic'], style: { foreground: theme.foreground, italic: true } },
    { scope: ['string', 'markup.link'], style: { foreground: theme.info } },
    { scope: ['comment', 'punctuation'], style: { foreground: theme.mutedForeground } },
  ])
}
