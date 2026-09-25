/**
 * The one-based lines of `planMarkdown` that a selection in the rendered plan came from. The
 * rendered text drops markdown syntax, so each selected line is matched by its words; null when
 * the selection cannot be found, such as one spanning a rendered table.
 */
export function planSelectionLines(
  planMarkdown: string,
  selected: string,
): { readonly start: number; readonly end: number } | null {
  const wanted = selected
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (wanted.length === 0) return null
  const source = planMarkdown.split(/\r?\n/)
  const start = source.findIndex((line) => line.includes(wanted[0]!))
  if (start < 0) return null
  const last = wanted.at(-1)!
  const end = source.findIndex((line, index) => index >= start && line.includes(last))
  return { start: start + 1, end: (end < 0 ? start : end) + 1 }
}

/** What the agent reads above the comment: the plan's own lines, quoted. */
export function planCommentQuote(planMarkdown: string, lines: { start: number; end: number }) {
  const quoted = planMarkdown
    .split(/\r?\n/)
    .slice(lines.start - 1, lines.end)
    .map((line) => `> ${line}`)
  const where =
    lines.start === lines.end ? `line ${lines.start}` : `lines ${lines.start}–${lines.end}`
  return [`About the proposed plan, ${where}:`, '', ...quoted].join('\n')
}
