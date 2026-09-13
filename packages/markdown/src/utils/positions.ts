import type { Nodes } from 'mdast'

/**
 * A suffix parsed on its own reports positions from its first character. The
 * document pipeline keys on absolute offsets, so the prefix's length and line
 * count are added back before the suffix joins the tree.
 */
export function shiftPositions(node: Nodes, offset: number, lines: number): void {
  if (node.position) {
    shiftPoint(node.position.start, offset, lines)
    shiftPoint(node.position.end, offset, lines)
  }
  if (!('children' in node)) return

  for (const child of node.children) shiftPositions(child, offset, lines)
}

function shiftPoint(
  point: { offset?: number | undefined; line: number },
  offset: number,
  lines: number,
) {
  if (point.offset !== undefined) point.offset += offset
  point.line += lines
}

/** Offset of the first character of the line a node starts on, or null without a position. */
export function nodeLineStart(node: Nodes): number | null {
  const start = node.position?.start
  if (start?.offset === undefined) return null

  return start.offset - (start.column - 1)
}

export function countLines(text: string): number {
  let lines = 0
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    lines += 1
  }

  return lines
}
