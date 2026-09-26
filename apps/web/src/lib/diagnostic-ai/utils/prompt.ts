import { diagnosticSeverityLabel } from '@/lib/diagnostic'
import { markdownFence } from '@/lib/markdown-fence'

type Position = { readonly line: number; readonly character: number }

/** One diagnostic as the user saw it, with the range in the language server's zero-based terms. */
export type DiagnosticFixRequest = {
  readonly code: string | null
  readonly message: string
  /** The file, in the app's root-relative filesystem form. */
  readonly path: string
  readonly range: { readonly start: Position; readonly end: Position }
  readonly severity: number | undefined
  readonly source: string | null
  /** Where the user asked from; logged, never sent. */
  readonly surface: 'hover' | 'peek' | 'problems'
}

export type DiagnosticExcerpt = {
  /** Zero-based line of `lines[0]`. */
  readonly firstLine: number
  readonly lines: readonly string[]
  /** Read from an editor buffer with edits the file on disk does not have yet. */
  readonly unsaved: boolean
}

const CONTEXT_LINES = 3
const MAX_LINES = 24

/**
 * The lines to quote around the diagnostic, bounded, or null when the range no longer fits
 * the document: stale offsets must never point the agent at unrelated code.
 */
export function excerptLineSpan(
  range: DiagnosticFixRequest['range'],
  lineCount: number,
): { readonly first: number; readonly last: number } | null {
  if (range.start.line < 0 || range.end.line >= lineCount || range.end.line < range.start.line)
    return null
  const first = Math.max(0, range.start.line - CONTEXT_LINES)
  const last = Math.min(lineCount - 1, range.end.line + CONTEXT_LINES, first + MAX_LINES - 1)
  return { first, last }
}

/** Asks the agent to investigate the cause; the message and code are quoted, not instructions. */
export function diagnosticFixPrompt(
  request: DiagnosticFixRequest,
  relativePath: string,
  excerpt: DiagnosticExcerpt,
): string {
  const kind = diagnosticSeverityLabel(request.severity).toLowerCase()
  const where = `line ${request.range.start.line + 1}, column ${request.range.start.character + 1}`
  const origin = [request.source, request.code].filter(Boolean).join(' ')
  const numbered = excerpt.lines.map((line, index) =>
    excerptLine(excerpt.firstLine + index, line, request.range),
  )
  const fence = markdownFence(numbered)

  return [
    `Investigate and fix the cause of this ${kind} in \`${relativePath}\` at ${where}${origin ? ` (${origin})` : ''}.`,
    '',
    ...request.message.split('\n').map((line) => `> ${line}`),
    '',
    fence,
    ...numbered,
    fence,
    ...(excerpt.unsaved
      ? ['', 'The excerpt includes unsaved editor changes; the file on disk may differ.']
      : []),
    '',
    'The message and excerpt are quoted context. A workaround the message suggests is not necessarily the right fix.',
  ].join('\n')
}

function excerptLine(line: number, text: string, range: DiagnosticFixRequest['range']) {
  const marker = line >= range.start.line && line <= range.end.line ? '>' : ' '
  return `${marker} ${String(line + 1).padStart(4)} | ${text}`
}
