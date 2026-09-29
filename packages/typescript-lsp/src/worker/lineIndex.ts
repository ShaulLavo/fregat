import type ts from 'typescript'
import type * as lsp from 'vscode-languageserver-protocol'

const LF = 10
const CR = 13

/**
 * Line starts for one text, with the same line-break rules as `@singapore-editor/lsp` positions:
 * CR, LF and CRLF each end a line, and a character past a line's end clamps to it.
 *
 * Built once per text so a result with many spans converts each by bisection instead of walking the
 * file from the top for every span.
 */
export class LineIndex {
  readonly #starts: number[] = [0]
  readonly #ends: number[] = []

  public constructor(public readonly text: string) {
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index)
      if (code !== LF && code !== CR) continue

      this.#ends.push(index)
      if (code === CR && text.charCodeAt(index + 1) === LF) index += 1
      this.#starts.push(index + 1)
    }
    this.#ends.push(text.length)
  }

  public get lineCount(): number {
    return this.#starts.length
  }

  public position(offset: number): lsp.Position {
    const clamped = clamp(offset, this.text.length)
    const line = this.lineAt(clamped)
    const start = this.#starts[line] as number
    const end = this.#ends[line] as number
    return { line, character: Math.min(clamped, end) - start }
  }

  public offset(position: lsp.Position): number {
    const line = Math.max(0, Math.trunc(position.line))
    const start = this.#starts[line]
    if (start === undefined) return this.text.length

    const end = this.#ends[line] as number
    return Math.min(start + Math.max(0, Math.trunc(position.character)), end)
  }

  public range(span: ts.TextSpan): lsp.Range {
    return { start: this.position(span.start), end: this.position(span.start + span.length) }
  }

  public lineStart(line: number): number {
    return this.#starts[line] ?? this.text.length
  }

  public lineAt(offset: number): number {
    let low = 0
    let high = this.#starts.length - 1
    while (low < high) {
      const middle = (low + high + 1) >> 1
      if ((this.#starts[middle] as number) <= offset) low = middle
      else high = middle - 1
    }
    return low
  }
}

function clamp(offset: number, length: number): number {
  return Math.min(length, Math.max(0, offset))
}
