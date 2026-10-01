export type PdfMatch = { readonly page: number; readonly start: number; readonly end: number }

function pageText(items: readonly string[]) {
  return items.join(' ')
}

export function searchPdf(
  pages: readonly (readonly string[])[],
  term: string,
): readonly PdfMatch[] {
  const needle = term.trim()
  if (!needle) return []
  // Search original text: Unicode lowercasing can change its length and shift highlight offsets.
  const pattern = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu')
  return pages.flatMap((items, page) =>
    Array.from(pageText(items).matchAll(pattern), (match) => ({
      page,
      start: match.index,
      end: match.index + match[0].length,
    })),
  )
}

export function itemHighlights(
  items: readonly string[],
  matches: readonly PdfMatch[],
  page: number,
) {
  let offset = 0
  return items.map((text) => {
    const start = offset
    offset += text.length + 1
    return matches
      .filter(
        (match) => match.page === page && match.start < start + text.length && match.end > start,
      )
      .map((match) => ({
        start: Math.max(0, match.start - start),
        end: Math.min(text.length, match.end - start),
      }))
  })
}
