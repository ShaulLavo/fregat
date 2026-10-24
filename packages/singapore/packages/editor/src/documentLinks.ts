import type { EditorVisibleRowSnapshot } from './plugins'

export type DocumentLink = {
  /** Document offset of the first character of the link. */
  readonly start: number
  /** Document offset one past the last character. */
  readonly end: number
  readonly url: string
}

/**
 * Matches http(s) URLs. Deliberately narrow: a buffer is full of things that look address-like
 * (paths, versions, generics), and a link that opens the wrong thing is worse than no link.
 */
const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/g

/**
 * Characters that commonly end a sentence or wrap a URL in prose, and are almost never meant as
 * part of the address. Trimmed from the tail so `see https://example.com.` links to the site.
 */
const TRAILING_PUNCTUATION = new Set(['.', ',', ';', ':', '!', '?', ')', ']', '}', '>', '"', "'"])

/**
 * Links within the mounted rows, in document offsets.
 *
 * Viewport-scoped for the same reason as occurrence highlighting: only visible links can be
 * clicked, and scanning the whole buffer on every render is a cost with no payoff.
 */
export function documentLinksInRows(
  rows: readonly EditorVisibleRowSnapshot[],
): readonly DocumentLink[] {
  const links: DocumentLink[] = []
  for (const row of rows) {
    if (!row.primaryText) continue

    appendRowLinks(links, row)
  }

  return links
}

/** The link containing `offset`, or null. */
export function documentLinkAtOffset(
  links: readonly DocumentLink[],
  offset: number,
): DocumentLink | null {
  for (const link of links) {
    if (offset < link.start) continue
    if (offset >= link.end) continue

    return link
  }

  return null
}

function appendRowLinks(links: DocumentLink[], row: EditorVisibleRowSnapshot): void {
  if (typeof row.text === 'string') {
    appendTextLinks(links, row.text, row.startOffset)
    return
  }
  for (const chunk of row.chunks) {
    appendRangeLinks(links, row, chunk.rowLocalStart, chunk.rowLocalEnd)
  }
}

function appendTextLinks(links: DocumentLink[], text: string, startOffset: number): void {
  URL_PATTERN.lastIndex = 0
  let match = URL_PATTERN.exec(text)
  while (match !== null) {
    const trimmed = trimTrailingPunctuation(match[0])
    const start = startOffset + match.index
    if (trimmed.length > 0 && links.at(-1)?.start !== start) {
      links.push({ start, end: start + trimmed.length, url: trimmed })
    }
    match = URL_PATTERN.exec(text)
  }
}

function appendRangeLinks(
  links: DocumentLink[],
  row: EditorVisibleRowSnapshot,
  start: number,
  end: number,
): void {
  let cursor = start
  while (cursor > 0 && !/[\s<>"'`]/.test(row.text.charAt(cursor - 1))) cursor -= 1
  while (cursor < end) {
    const prefix = row.text.slice(cursor, Math.min(row.text.length, cursor + 8))
    if (prefix.startsWith('https://') || prefix.startsWith('http://')) {
      cursor = appendRangeLink(links, row, cursor)
      continue
    }
    cursor += 1
  }
}

function appendRangeLink(
  links: DocumentLink[],
  row: EditorVisibleRowSnapshot,
  start: number,
): number {
  let end = start
  while (end < row.text.length && !/[\s<>"'`]/.test(row.text.charAt(end))) end += 1
  appendTextLinks(links, row.text.slice(start, end), row.startOffset + start)
  return end
}

/**
 * Drops trailing punctuation, but keeps a closing bracket that the URL itself opened — wiki-style
 * addresses really do end in `)`.
 */
function trimTrailingPunctuation(url: string): string {
  let end = url.length
  while (end > 0) {
    const char = url[end - 1]
    if (char === undefined || !TRAILING_PUNCTUATION.has(char)) break
    // Balance is measured over the text *before* this ')': including it would always read as
    // balanced and drop a paren the address itself opened.
    if (char === ')' && hasUnclosedParen(url.slice(0, end - 1))) break

    end -= 1
  }

  return url.slice(0, end)
}

function hasUnclosedParen(text: string): boolean {
  let depth = 0
  for (const char of text) {
    if (char === '(') depth += 1
    else if (char === ')') depth -= 1
  }

  return depth > 0
}
