import { decodeCodeLines } from '@workspace/markdown/utils/inline-code-source'

export type PlanSelectionLines = { readonly start: number; readonly end: number }

type SelectedText = { readonly node: Text; readonly from: number; to: number }

export function planSelectionLines(
  container: HTMLElement,
  lineOffset = 0,
): PlanSelectionLines | null {
  const selection = container.ownerDocument.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!container.contains(range.commonAncestorContainer) || !selection.toString().trim())
    return null
  const pieces = selectedText(container, range)
  trimSelectionEnd(pieces)
  const lines = pieces.flatMap(textLines)
  if (!lines.length) return null
  return { start: Math.min(...lines) + lineOffset, end: Math.max(...lines) + lineOffset }
}

function selectedText(container: HTMLElement, range: Range): SelectedText[] {
  const start = range.cloneRange()
  start.collapse(true)
  const end = range.cloneRange()
  end.collapse(false)
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT)
  const pieces: SelectedText[] = []
  let node = walker.nextNode()
  while (node) {
    if (node instanceof Text && node.length > 0 && overlaps(node, start, end))
      pieces.push({
        node,
        from: node === range.startContainer ? range.startOffset : 0,
        to: node === range.endContainer ? range.endOffset : node.length,
      })
    node = walker.nextNode()
  }
  return pieces
}

function overlaps(node: Text, start: Range, end: Range): boolean {
  const point = node.ownerDocument.createRange()
  point.setStart(node, node.length)
  point.collapse(true)
  if (point.compareBoundaryPoints(Range.START_TO_START, start) <= 0) return false
  point.setStart(node, 0)
  point.collapse(true)
  return point.compareBoundaryPoints(Range.START_TO_START, end) < 0
}

function trimSelectionEnd(pieces: SelectedText[]): void {
  while (pieces.length) {
    const last = pieces.at(-1)!
    const text = last.node.data.slice(last.from, last.to)
    last.to -= text.length - text.trimEnd().length
    if (last.to > last.from) return
    pieces.pop()
  }
}

function textLines(piece: SelectedText): number[] {
  const code = piece.node.parentElement?.closest<HTMLElement>('code[data-source-code-lines]')
  if (!code) return ordinaryLines(piece)
  const lines = decodeCodeLines(code.dataset.sourceCodeLines ?? '', code.textContent?.length ?? 0)
  if (!lines) return []
  const prefix = code.ownerDocument.createRange()
  prefix.selectNodeContents(code)
  prefix.setEnd(piece.node, piece.from)
  const from = prefix.toString().length
  const to = from + piece.to - piece.from
  const offset = nearestOffset(code)
  return lines.runs
    .filter((run) => run.from < to && run.to > from)
    .flatMap((run) => [run.firstLine + offset, run.lastLine + offset])
}

function nearestOffset(element: HTMLElement): number {
  return Number(
    element.closest<HTMLElement>('[data-source-line-offset]')?.dataset.sourceLineOffset ?? 0,
  )
}

function ordinaryLines(piece: SelectedText): number[] {
  const source = piece.node.parentElement?.closest<HTMLElement>('[data-source-line]')
  if (!source) return []
  const prefix = source.ownerDocument.createRange()
  prefix.selectNodeContents(source)
  prefix.setEnd(piece.node, piece.from)
  const start = prefixLineCount(prefix)
  prefix.setEnd(piece.node, piece.to)
  const end = prefixLineCount(prefix)
  const first = Number(source.dataset.sourceLine)
  const last = Number(source.dataset.sourceEndLine)
  const offset = nearestOffset(source)
  return [Math.min(first + start, last) + offset, Math.min(first + end, last) + offset]
}

function prefixLineCount(prefix: Range): number {
  let lines = prefix.toString().split('\n').length - 1
  for (const code of prefix
    .cloneContents()
    .querySelectorAll<HTMLElement>('code[data-source-line][data-source-end-line]')) {
    lines += Number(code.dataset.sourceEndLine) - Number(code.dataset.sourceLine)
    lines -= (code.textContent ?? '').split('\n').length - 1
  }
  return lines
}

/** What the agent reads above the comment: the plan's own lines, quoted. */
export function planCommentQuote(planMarkdown: string, lines: { start: number; end: number }) {
  return markdownQuote(planMarkdown, lines, 'the proposed plan')
}

/** Lines of a markdown source, quoted under where they came from. */
export function markdownQuote(
  markdown: string,
  lines: { start: number; end: number },
  subject: string,
) {
  const quoted = markdown
    .split(/\r\n|\r|\n/)
    .slice(lines.start - 1, lines.end)
    .map((line) => `> ${line}`)
  const where =
    lines.start === lines.end ? `line ${lines.start}` : `lines ${lines.start}–${lines.end}`
  return [`About ${subject}, ${where}:`, ''].concat(quoted).join('\n')
}

export function planSourceLineOffset(planMarkdown: string, displayedMarkdown: string) {
  return (
    planMarkdown.trimEnd().split(/\r\n|\r|\n/).length - displayedMarkdown.split(/\r\n|\r|\n/).length
  )
}
