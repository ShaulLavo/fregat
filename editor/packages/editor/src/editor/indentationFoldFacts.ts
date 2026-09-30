import { getPieceTreeSnapshot, type TextSnapshot } from '../documentTextSnapshot'
import { createPieceTableWalker } from '@singapore-editor/textbuffer'
import {
  EditorRegionMarkerClassifier,
  type EditorFoldingRules,
  type EditorRegionMarker,
} from './languageConfiguration'

export const FOLD_FACT_BLOCK_SIZE = 128
export type FoldLineOwner = { readonly id: number }
export type FoldLineReference = { readonly owner: FoldLineOwner; readonly slot: number }
export type FoldLineFact = {
  readonly length: number
  readonly indent: number
  readonly marker: EditorRegionMarker
}
export type FoldFactBlock = {
  readonly owner: FoldLineOwner
  readonly startSlot: number
  readonly facts: readonly FoldLineFact[]
  readonly offsets: readonly number[]
  readonly length: number
}

let ownerSequence = 0

function nextFoldLineOwner(): FoldLineOwner {
  ownerSequence += 1
  return { id: ownerSequence }
}

export function createFoldFactBlock(
  facts: readonly FoldLineFact[],
  owner: FoldLineOwner = nextFoldLineOwner(),
  startSlot = 0,
): FoldFactBlock {
  const offsets = [0]
  let length = 0
  for (const fact of facts) {
    length += fact.length
    offsets.push(length)
  }
  return { owner, startSlot, facts, offsets, length }
}

export function sliceFoldFactBlock(
  block: FoldFactBlock,
  start: number,
  end: number,
): FoldFactBlock {
  if (start === 0 && end === block.facts.length) return block
  return createFoldFactBlock(block.facts.slice(start, end), block.owner, block.startSlot + start)
}

export function foldLineReference(block: FoldFactBlock, index: number): FoldLineReference {
  return { owner: block.owner, slot: block.startSlot + index }
}

export function sameFoldLine(left: FoldLineReference, right: FoldLineReference): boolean {
  return left.owner === right.owner && left.slot === right.slot
}

export function sameFoldFacts(left: FoldLineFact, right: FoldLineFact): boolean {
  return left.indent === right.indent && left.marker === right.marker
}

type SnapshotCursor = { next(): number; seek(offset: number): void }
type BorrowedChunk = { readonly text: string; readonly start: number; readonly end: number }

function snapshotCursor(snapshot: TextSnapshot): SnapshotCursor {
  const tree = getPieceTreeSnapshot(snapshot)
  if (tree) return createPieceTableWalker(tree)
  const chunks: BorrowedChunk[] = []
  snapshot.forEachTextChunk((text, start, end) => chunks.push({ text, start, end }))
  let chunkIndex = 0
  let position = 0
  return {
    next() {
      const chunk = chunks[chunkIndex]
      if (!chunk) return -1
      const code = chunk.text.charCodeAt(position++)
      if (position === chunk.text.length) {
        chunkIndex += 1
        position = 0
      }
      return code
    },
    seek(offset) {
      chunkIndex = firstChunkAfter(chunks, offset)
      position = offset - (chunks[chunkIndex]?.start ?? offset)
    },
  }
}

function firstChunkAfter(chunks: readonly BorrowedChunk[], offset: number): number {
  let low = 0
  let high = chunks.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (chunks[middle]!.end > offset) high = middle
    else low = middle + 1
  }
  return low
}

/** A resumable line scan; even a single enormous line fits the caller's code-unit budget. */
export class FoldFactReader {
  private readonly cursor: SnapshotCursor
  private marker: EditorRegionMarkerClassifier
  private length = 0
  private indent = 0
  private hasContent = false
  private column = 0
  codeUnitsRead = 0

  constructor(
    snapshot: TextSnapshot,
    private readonly rules: EditorFoldingRules,
    private readonly tabSize: number,
  ) {
    this.cursor = snapshotCursor(snapshot)
    this.marker = new EditorRegionMarkerClassifier(rules.regionMarkers)
  }

  seek(offset: number): void {
    this.cursor.seek(offset)
    this.reset()
  }

  next(budget: number): FoldLineFact | null {
    const end = this.codeUnitsRead + budget
    while (this.codeUnitsRead < end) {
      const code = this.cursor.next()
      if (code === -1 || code === 10) return this.finish(code === 10)
      this.codeUnitsRead += 1
      this.length += 1
      this.consume(code)
    }
    return null
  }

  private consume(code: number): void {
    this.marker.push(code)
    if (this.hasContent) return
    if (code === 32) {
      this.column += 1
      return
    }
    if (code === 9) {
      this.column += this.tabSize - (this.column % this.tabSize)
      return
    }
    this.hasContent = true
    this.indent = this.column
  }

  private finish(lineBreak: boolean): FoldLineFact {
    if (lineBreak) this.codeUnitsRead += 1
    const fact = {
      length: this.length + Number(lineBreak),
      indent: this.hasContent ? this.indent : -1,
      marker: this.hasContent ? this.marker.finish() : null,
    }
    this.reset()
    return fact
  }

  private reset(): void {
    this.marker = new EditorRegionMarkerClassifier(this.rules.regionMarkers)
    this.length = 0
    this.indent = 0
    this.hasContent = false
    this.column = 0
  }
}
