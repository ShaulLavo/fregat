import type { TextReadSnapshot } from '../documentTextSnapshot'

export const CURSOR_PAGE = 16_384
const CURSOR_PAGES = 4

/** Unit reads and searches through fixed pages of a snapshot, the last few kept. */
export class TextCursor {
  readonly length: number
  readonly #pages = new Map<number, string>()
  #page = ''
  #pageStart = 0

  constructor(private readonly source: TextReadSnapshot) {
    this.length = source.length
  }

  codeAt(offset: number): number {
    const local = offset - this.#pageStart
    if (local >= 0 && local < this.#page.length) return this.#page.charCodeAt(local)
    if (offset < 0 || offset >= this.length) return Number.NaN

    this.load(offset)
    return this.#page.charCodeAt(offset - this.#pageStart)
  }

  startsWith(token: string, offset: number): boolean {
    for (let index = 0; index < token.length; index += 1) {
      if (this.codeAt(offset + index) !== token.charCodeAt(index)) return false
    }

    return true
  }

  indexOf(token: string, from: number): number {
    for (let start = from; start < this.length;) {
      this.load(start)
      const found = this.#page.indexOf(token, start - this.#pageStart)
      if (found !== -1) return this.#pageStart + found

      const pageEnd = this.#pageStart + this.#page.length
      // A match the page cuts off starts in its last `token.length - 1` units.
      for (let at = Math.max(start, pageEnd - token.length + 1); at < pageEnd; at += 1) {
        if (this.startsWith(token, at)) return at
      }
      start = pageEnd
    }

    return -1
  }

  /** The first offset in [`from`, `to`) where `unit`, a global single-unit pattern, matches. */
  search(unit: RegExp, from: number, to: number): number {
    const end = Math.min(to, this.length)
    for (let start = from; start < end; start = this.#pageStart + this.#page.length) {
      this.load(start)
      unit.lastIndex = start - this.#pageStart
      const found = unit.exec(this.#page)
      if (!found) continue

      const offset = this.#pageStart + found.index
      return offset < end ? offset : -1
    }

    return -1
  }

  slice(start: number, end: number): string {
    const pageStart = start - (start % CURSOR_PAGE)
    if (end > pageStart + CURSOR_PAGE) return this.source.readRange(start, end)

    this.load(start)
    return this.#page.slice(start - pageStart, end - pageStart)
  }

  private load(offset: number): void {
    const pageStart = offset - (offset % CURSOR_PAGE)
    let page = this.#pages.get(pageStart)
    if (page === undefined) {
      page = this.source.readRange(pageStart, Math.min(this.length, pageStart + CURSOR_PAGE))
      if (this.#pages.size === CURSOR_PAGES) this.#pages.delete(this.#pages.keys().next().value!)
      this.#pages.set(pageStart, page)
    }
    this.#page = page
    this.#pageStart = pageStart
  }
}
