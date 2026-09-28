import type { PagedRow, PagedWindow } from './document'

export class LineWindow {
  readonly #rows: PagedRow[] = []
  #line: number
  #offset: number
  #rowStart: number
  #row = ''
  #kept = 0
  #truncated = false

  constructor(
    private readonly target: number,
    private readonly count: number,
    checkpoint: { line: number; utf16Offset: number },
    private readonly limit: number,
    private readonly revision: string,
  ) {
    this.#line = checkpoint.line
    this.#offset = checkpoint.utf16Offset
    this.#rowStart = this.#offset
  }

  append(text: string): boolean {
    for (const part of splitLines(text)) if (this.appendPart(part.text, part.newline)) return true
    return false
  }

  finish() {
    if (this.#line >= this.target) this.pushRow()
    return this.result()
  }

  result(): PagedWindow {
    return { revision: this.revision, rows: this.#rows, truncated: this.#truncated }
  }

  private appendPart(text: string, newline: boolean): boolean {
    if (this.#line >= this.target && this.keepText(text)) return true
    this.#offset += text.length + Number(newline)
    if (!newline) return false
    if (this.#line >= this.target) this.pushRow()
    this.#line++
    this.#rowStart = this.#offset
    this.#row = ''
    return this.#rows.length === this.count
  }

  private keepText(text: string): boolean {
    const remaining = this.limit - this.#kept
    this.#row += text.slice(0, remaining)
    this.#kept += Math.min(text.length, remaining)
    if (text.length <= remaining) return false
    this.#truncated = true
    this.pushRow()
    return true
  }

  private pushRow() {
    this.#rows.push({ line: this.#line, offset: this.#rowStart, text: this.#row })
  }
}

function* splitLines(text: string) {
  let start = 0
  for (let at = text.indexOf('\n'); at !== -1; at = text.indexOf('\n', at + 1)) {
    yield { text: text.slice(start, at), newline: true }
    start = at + 1
  }
  if (start < text.length) yield { text: text.slice(start), newline: false }
}
