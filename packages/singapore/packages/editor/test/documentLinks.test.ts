import { describe, expect, it } from 'vitest'

import { documentLinkAtOffset, documentLinksInRows } from '../src/documentLinks'
import type { EditorVisibleRowSnapshot } from '../src/plugins'

function rows(lines: readonly string[]): EditorVisibleRowSnapshot[] {
  let offset = 0
  return lines.map((text, index) => {
    const row: EditorVisibleRowSnapshot = {
      bufferRow: index,
      endOffset: offset + text.length,
      height: 20,
      index,
      kind: 'text',
      primaryText: true,
      firstWrapSegment: true,
      source: 'document',
      startOffset: offset,
      text,
      top: index * 20,
      leftSpacerWidth: 0,
      contentCursorLine: false,
      gutterNumberCursorLine: false,
      gutterCursorLineBackgroundLaneIds: [],
      mountedPaintSupport: 'replayable',
      chunks: [],
      foldMarker: null,
    }
    offset += text.length + 1
    return row
  })
}

describe('documentLinksInRows', () => {
  it('finds a url and reports it in document offsets', () => {
    const links = documentLinksInRows(rows(['see https://example.com now']))

    expect(links).toEqual([{ end: 23, start: 4, url: 'https://example.com' }])
  })

  it('finds links on later rows', () => {
    const links = documentLinksInRows(rows(['first', 'go https://a.dev']))

    // 'first\n' is 6 characters, then 'go ' — so the link starts at 9 and runs its own length.
    expect(links).toEqual([{ end: 9 + 'https://a.dev'.length, start: 9, url: 'https://a.dev' }])
  })

  it('drops sentence punctuation that is not part of the address', () => {
    const links = documentLinksInRows(rows(['read https://example.com.']))

    expect(links[0]?.url).toBe('https://example.com')
  })

  // Wiki-style URLs really do end in ')', so a closer the URL itself opened is kept.
  it('keeps a closing paren the url opened', () => {
    const links = documentLinksInRows(rows(['https://en.wikipedia.org/wiki/Foo_(bar)']))

    expect(links[0]?.url).toBe('https://en.wikipedia.org/wiki/Foo_(bar)')
  })

  it('drops a closing paren that merely wraps the url', () => {
    const links = documentLinksInRows(rows(['(https://example.com)']))

    expect(links[0]?.url).toBe('https://example.com')
  })

  it('finds several links on one row', () => {
    const links = documentLinksInRows(rows(['https://a.dev and https://b.dev']))

    expect(links.map((link) => link.url)).toEqual(['https://a.dev', 'https://b.dev'])
  })

  it('ignores text that only looks address-like', () => {
    const links = documentLinksInRows(rows(['import x from "./a/b"', 'Map<string, number>']))

    expect(links).toEqual([])
  })

  it('skips rows that are not primary document text', () => {
    const [row] = rows(['https://example.com'])
    if (!row) throw new Error('fixture row missing')

    expect(documentLinksInRows([{ ...row, primaryText: false }])).toEqual([])
  })

  it('finds a link on a soft-wrap continuation', () => {
    const [row] = rows(['https://example.com'])
    if (!row) throw new Error('fixture row missing')

    expect(documentLinksInRows([{ ...row, firstWrapSegment: false }])).toEqual([
      { end: 19, start: 0, url: 'https://example.com' },
    ])
  })
})

describe('documentLinkAtOffset', () => {
  const links = documentLinksInRows(rows(['see https://example.com now']))

  it('finds the link under an offset inside it', () => {
    expect(documentLinkAtOffset(links, 10)?.url).toBe('https://example.com')
  })

  it('includes the first character and excludes the one past the end', () => {
    expect(documentLinkAtOffset(links, 4)).not.toBeNull()
    expect(documentLinkAtOffset(links, 23)).toBeNull()
  })

  it('returns null outside every link', () => {
    expect(documentLinkAtOffset(links, 0)).toBeNull()
  })
})
