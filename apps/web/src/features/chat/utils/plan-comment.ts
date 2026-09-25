export type PlanSelectionLines = { readonly start: number; readonly end: number }

/** Source positions follow the selected DOM nodes, including repeated and formatted text. */
export function planSelectionLines(
  container: HTMLElement,
  lineOffset = 0,
): PlanSelectionLines | null {
  const selection = container.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer) || !selection.toString().trim())
    return null
  const start = boundaryLine(range.startContainer, range.startOffset, false)
  const end = boundaryLine(range.endContainer, range.endOffset, true)
  return start === null || end === null
    ? null
    : { start: start + lineOffset, end: end + lineOffset }
}

function boundaryLine(node: Node, offset: number, end: boolean): number | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement
  if (!(element instanceof Element)) return null
  const source = element.closest<HTMLElement>('[data-source-line]')
  if (!source) return null
  const prefix = source.ownerDocument.createRange()
  prefix.selectNodeContents(source)
  prefix.setEnd(node, offset)
  const text = end ? prefix.toString().trimEnd() : prefix.toString()
  const line = Number(source.dataset.sourceLine) + text.split('\n').length - 1
  return Math.min(line, Number(source.dataset.sourceEndLine))
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

export function planSourceLineOffset(planMarkdown: string, displayedMarkdown: string) {
  return planMarkdown.trimEnd().split(/\r?\n/).length - displayedMarkdown.split(/\r?\n/).length
}
