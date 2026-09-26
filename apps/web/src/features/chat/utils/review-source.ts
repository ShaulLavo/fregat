/**
 * Whether a sent review comment still points at what it quoted. A source that moved or changed
 * reads as changed: opening it would show the reader lines the comment was never about.
 */

type LineRange = { readonly start: number; readonly end: number }

/**
 * One side of a quoted diff excerpt without its markers: the new side is its added and context
 * lines, the old side its deleted and context lines.
 */
export function diffQuoteLines(quote: string, side: 'new' | 'old'): string[] | null {
  const lines = quote.split('\n')
  const header = lines.findIndex((line) => line.startsWith('@@ '))
  if (header < 0) return null

  const otherSide = side === 'new' ? '-' : '+'
  const body: string[] = []
  for (const line of lines.slice(header + 1)) {
    if (/^`{3,}\s*$/.test(line)) break
    if (line.startsWith(otherSide)) continue
    body.push(line.slice(1))
  }
  return body
}

/** The quoted lines of a plan or reply excerpt: its `> ` lines, unquoted. */
export function blockQuoteLines(quote: string): string[] {
  return quote
    .split('\n')
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^> ?/, ''))
}

/** True when `text`'s one-based `lines` read exactly `expected`. */
export function linesMatch(text: string, lines: LineRange, expected: readonly string[]) {
  const actual = text.split(/\r?\n/).slice(lines.start - 1, lines.end)
  return (
    actual.length === expected.length && actual.every((line, index) => line === expected[index])
  )
}
