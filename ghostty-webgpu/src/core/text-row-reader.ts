import { SnapshotReader } from './snapshot-reader.js'
import type { GhosttyRuntime } from './runtime.js'
import type { ReadTextRowsOptions, RenderTextRow, TerminalSize } from './types.js'

const rowWords = 3
const cellWords = 3
const continuationFlag = 0x80000000

interface TextRecords {
  readonly words: Uint32Array
  readonly graphemes: Uint32Array
}

function* textCodepoints({ words, graphemes }: TextRecords): Generator<number> {
  for (let offset = 0; offset < words.length; offset += cellWords) {
    if ((words[offset]! & continuationFlag) !== 0) continue
    const length = words[offset + 2]!
    if (length === 0) {
      yield words[offset]! & ~continuationFlag || 32
      continue
    }
    const start = words[offset + 1]!
    for (let index = start; index < start + length; index += 1) yield graphemes[index]!
  }
}

function matchingTextRecords(before: TextRecords, after: TextRecords): boolean | undefined {
  if (before.words.length !== after.words.length) return undefined
  for (let offset = 0; offset < before.words.length; offset += cellWords) {
    const left = before.words[offset]!
    const right = after.words[offset]!
    const continuation = (left & continuationFlag) !== 0
    if (continuation !== ((right & continuationFlag) !== 0)) return undefined
    if (continuation) continue
    const length = before.words[offset + 2]!
    if (length !== after.words[offset + 2]!) return undefined
    if (length === 0) {
      if ((left & ~continuationFlag || 32) !== (right & ~continuationFlag || 32)) return false
      continue
    }
    const leftStart = before.words[offset + 1]!
    const rightStart = after.words[offset + 1]!
    for (let index = 0; index < length; index += 1) {
      if (before.graphemes[leftStart + index] !== after.graphemes[rightStart + index]) return false
    }
  }
  return true
}

export function equalTextRows(left: RenderTextRow, right: RenderTextRow): boolean {
  if (left === right) return true
  if (left instanceof CopiedTextRow && right instanceof CopiedTextRow) return left.matches(right)
  return left.text === right.text
}

function equalTextRecords(before: TextRecords, after: TextRecords): boolean {
  const matching = matchingTextRecords(before, after)
  if (matching !== undefined) return matching
  const leftPoints = textCodepoints(before)
  const rightPoints = textCodepoints(after)
  while (true) {
    const a = leftPoints.next()
    const b = rightPoints.next()
    if (a.done || b.done) return a.done === b.done
    if (a.value !== b.value) return false
  }
}

function cellText(words: Uint32Array, offset: number, graphemes: Uint32Array): string {
  const length = words[offset + 2]!
  if (length === 0) {
    const codepoint = words[offset]! & ~continuationFlag
    return codepoint === 0 ? '' : String.fromCodePoint(codepoint)
  }
  const start = words[offset + 1]!
  let text = ''
  for (let index = start; index < start + length; index += 1)
    text += String.fromCodePoint(graphemes[index]!)
  return text
}

class CopiedTextRow implements RenderTextRow {
  readonly y: number
  readonly #records: TextRecords
  #text: string | undefined
  #cells: readonly string[] | undefined
  #continuations: readonly boolean[] | undefined

  constructor(y: number, words: Uint32Array, graphemes: Uint32Array) {
    this.y = y
    this.#records = { words, graphemes }
    Object.defineProperties(this, rowAccessors)
    Object.freeze(this)
  }

  matches(other: CopiedTextRow): boolean {
    return equalTextRecords(this.#records, other.#records)
  }

  get text(): string {
    if (this.#text !== undefined) return this.#text
    const { words, graphemes } = this.#records
    this.#text = ''
    for (let offset = 0; offset < words.length; offset += cellWords) {
      if ((words[offset]! & continuationFlag) !== 0) continue
      this.#text += cellText(words, offset, graphemes) || ' '
    }
    return this.#text
  }

  get cells(): readonly string[] {
    const { words, graphemes } = this.#records
    return (this.#cells ??= Object.freeze(
      Array.from({ length: words.length / cellWords }, (_, index) =>
        cellText(words, index * cellWords, graphemes),
      ),
    ))
  }

  get continuations(): readonly boolean[] {
    const { words } = this.#records
    return (this.#continuations ??= Object.freeze(
      Array.from(
        { length: words.length / cellWords },
        (_, index) => (words[index * cellWords]! & continuationFlag) !== 0,
      ),
    ))
  }
}

// Own enumerable accessors keep structured clone and JSON transfer complete.
const rowAccessors = Object.fromEntries(
  ['text', 'cells', 'continuations'].map((name) => [
    name,
    { ...Object.getOwnPropertyDescriptor(CopiedTextRow.prototype, name), enumerable: true },
  ]),
)

export class TextRowReader {
  private readonly snapshots: SnapshotReader

  constructor(runtime: GhosttyRuntime) {
    this.snapshots = new SnapshotReader(runtime, {
      rowWords,
      cellWords,
      operation: 'bridge_read_text_rows',
      extract: (...args) => runtime.bridge.readTextRows(...args),
    })
  }

  read(
    state: number,
    iterator: number,
    cells: number,
    grid: Pick<TerminalSize, 'columns' | 'rows'>,
    options: ReadTextRowsOptions,
  ): readonly RenderTextRow[] {
    if (grid.rows === 0) return Object.freeze([])
    const snapshot = this.snapshots.read(state, iterator, cells, grid, options)
    const records = snapshot.cells.slice()
    const graphemes = snapshot.graphemes.slice()
    const rows: RenderTextRow[] = []
    for (let offset = 0; offset < snapshot.rows.length; offset += rowWords) {
      const start = snapshot.rows[offset + 1]! * cellWords
      const end = start + snapshot.rows[offset + 2]! * cellWords
      rows.push(new CopiedTextRow(snapshot.rows[offset]!, records.subarray(start, end), graphemes))
    }
    return Object.freeze(rows)
  }

  dispose(): void {
    this.snapshots.dispose()
  }
}
