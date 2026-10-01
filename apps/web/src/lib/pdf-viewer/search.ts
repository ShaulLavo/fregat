export type PdfMatch = { readonly page: number; readonly start: number; readonly end: number }
export type PdfTextRun = {
  readonly str: string
  readonly width: number
  readonly height: number
  readonly transform: readonly number[]
  readonly hasEOL: boolean
}
export type PdfPageText = {
  readonly text: string
  readonly items: readonly { readonly start: number; readonly end: number }[]
}

function separator(previous: PdfTextRun | undefined, item: PdfTextRun) {
  if (!previous || !previous.str || !item.str || /\s$/.test(previous.str) || /^\s/.test(item.str))
    return ''
  if (previous.hasEOL) return '\n'
  const [a = 1, b = 0, , , x = 0, y = 0] = previous.transform
  const length = Math.hypot(a, b) || 1
  const dx = (item.transform[4] ?? 0) - x
  const dy = (item.transform[5] ?? 0) - y
  const height = Math.max(previous.height, item.height)
  const across = Math.abs((-dx * b + dy * a) / length)
  if (across > height / 2) return '\n'
  const gap = (dx * a + dy * b) / length - previous.width
  return gap > height * 0.15 ? ' ' : ''
}

export function pdfPageText(runs: readonly PdfTextRun[]): PdfPageText {
  let text = ''
  let previous: PdfTextRun | undefined
  const items = runs.map((item) => {
    text += separator(previous, item)
    const start = text.length
    text += item.str
    previous = item
    return { start, end: text.length }
  })
  return { text, items }
}

export function searchPdf(pages: readonly PdfPageText[], term: string): readonly PdfMatch[] {
  const needle = term.trim()
  if (!needle) return []
  // Search original text: Unicode lowercasing can change its length and shift highlight offsets.
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return pages.flatMap(({ text }, page) =>
    Array.from(text.matchAll(pattern), (match) => ({
      page,
      start: match.index,
      end: match.index + match[0].length,
    })),
  )
}

export function itemHighlights(
  text: PdfPageText,
  matches: readonly PdfMatch[],
  page: number,
  selected?: PdfMatch,
) {
  return text.items.map(({ start, end }) =>
    matches
      .filter((match) => match.page === page && match.start < end && match.end > start)
      .map((match) => ({
        start: Math.max(0, match.start - start),
        end: Math.min(end, match.end) - start,
        selected: match === selected,
      })),
  )
}
