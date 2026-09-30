import type { StandInTable } from './standIns'
import type { DocumentLineEnding } from './lineEndings'

declare const pieceBufferIdBrand: unique symbol

// The sequence number of one contiguous span of inserted text (or the original
// text, id 0). Several ids can share a chunk string once inserts fill it, but
// an id never spans two chunks, so `(buffer, start)` stays an insertion
// identity. A number, not a string, so the hot paths never parse or hash text.
export type PieceBufferId = number & {
  readonly [pieceBufferIdBrand]: true
}

export type Point = {
  readonly row: number
  readonly column: number
}

export type AnchorBias = 'left' | 'right'

export type AnchorLiveness = 'live' | 'deleted'

export type RealAnchor = {
  readonly kind: 'anchor'
  readonly buffer: PieceBufferId
  readonly offset: number
  readonly bias: AnchorBias
}

type SentinelAnchor = { kind: 'min' } | { kind: 'max' }

export type Anchor = RealAnchor | SentinelAnchor

export type ResolvedAnchor = {
  readonly offset: number
  readonly liveness: AnchorLiveness
}

export type Piece = {
  readonly buffer: PieceBufferId
  readonly start: number
  readonly length: number
  readonly order: number
  readonly lineBreaks: number
  // Where the piece's breaks begin in its chunk's line index: the position of
  // the first break at or after `start`. A chunk only grows at its end, so the
  // position never moves and a search covers `lineBreaks` entries, not the chunk.
  readonly firstLineBreak: number
  readonly visible: boolean
}

// Ownership by epoch. A node whose epoch equals the lineage's current epoch
// was created since the last retain, so no retained snapshot can see it and an
// edit may mutate it in place. Retaining advances the epoch; every node then
// reads as foreign and the next edit clones its path once, as before.
export type PieceTableLineage = {
  epoch: number
  // Retain before every primitive edit, which is the persistent behaviour the
  // editor gets today. Off only for a caller that retains explicitly.
  readonly autoRetain: boolean
}

export type PieceTableBuffers = {
  // Shared across this document lineage, including divergent persistent versions.
  // Hosts can key WeakMap sidecars by this identity without putting UI caches in storage.
  readonly identity: object
  readonly lineage: PieceTableLineage
  readonly original: PieceBufferId
  readonly chunks: PieceBufferChunks
  readonly nextBufferSequence: number
  // Stored text is always LF-only; these record what the document arrived with
  // so a host can round-trip it on save. See pieceTable/lineEndings.ts.
  readonly lineEnding: DocumentLineEnding
  readonly byteOrderMark: string
  // Ingestion folded U+2028/U+2029 into real line breaks, so the document is no
  // longer byte-identical to the one the host handed us. Recorded rather than
  // acted on: the fold is not reversible, and only the host can decide whether
  // a warning is owed. See pieceTable/lineEndings.ts.
  readonly containsUnusualLineTerminators: boolean
  // Some text this lineage ever held has a surrogate code unit. While false no
  // offset can cut a pair, so edits skip every surrogate check. Never cleared:
  // deleted text stays as a tombstone an undo can bring back.
  readonly containsSurrogates: boolean
  // One index per chunk string, keyed by chunk sequence and shared by every
  // snapshot on the same log. Original-piece counting builds chunk 0's index;
  // append indexes remain lazy.
  readonly lineIndexes: Map<number, PieceBufferLineIndex>
}

export type PieceBufferLineIndex = {
  // Grown by doubling, so `offsets.length` is capacity and `count` is the only
  // safe bound to read or search within.
  offsets: Uint32Array
  count: number
  scannedLength: number
}

// `size` counts logical chunk slots. `get` and iteration expose dense chunks only;
// sparse text is read through bufferSpanAt/forEachBufferSpan with logical offsets.
export type PieceBufferChunks = {
  readonly size: number
  get(buffer: PieceBufferId): string | undefined
  keys(): IterableIterator<PieceBufferId>
  [Symbol.iterator](): IterableIterator<[PieceBufferId, string]>
}

export type PieceTreeNode = {
  piece: Piece
  left: PieceTreeNode | null
  right: PieceTreeNode | null
  height: number
  epoch: number
  // Length of the original buffer's pieces, tombstones included. They keep
  // their buffer order in the document, so this is a prefix sum that finds the
  // piece holding an original offset with no index at all.
  subtreeOriginalLength: number
  subtreeVisibleLength: number
  subtreePieces: number
  subtreeLineBreaks: number
  // The oldest buffer in the subtree. A deleted anchor's gap ends at the
  // nearest piece no newer than its own, and this finds that piece.
  subtreeMinBuffer: number
}

// The pieces of one inserted buffer that has been cut, keyed by start. The
// first piece is keyed 0: it covers the buffer from wherever it begins.
export type PieceTableReverseSplitNode = {
  readonly start: number
  readonly order: number
  readonly height: number
  readonly left: PieceTableReverseSplitNode | null
  readonly right: PieceTableReverseSplitNode | null
}

// One inserted buffer's entry: the order of its only piece, or its pieces.
export type PieceTableReverseSlot = number | PieceTableReverseSplitNode | undefined

export type PieceTableReverseBranch = readonly (
  | PieceTableReverseBranch
  | readonly PieceTableReverseSlot[]
)[]

// Shared by every snapshot that appended to it in turn. A snapshot reads only
// below its own count, so a newer one may fill the free slots in place.
export type PieceTableReverseTail = {
  readonly slots: PieceTableReverseSlot[]
  used: number
}

// Buffer id to the order of its pieces, for inserted buffers: a persistent
// vector, because ids are dense and the newest one is always appended. The
// original buffer is not here; the sequence tree finds its pieces.
export type PieceTableReverseIndex = {
  // Inserted buffers indexed: ids 1 to count.
  readonly count: number
  readonly shift: number
  readonly root: PieceTableReverseBranch | readonly PieceTableReverseSlot[] | null
  readonly tail: PieceTableReverseTail
  // Where each compacted tombstone's stand-in is now. See standIns.ts.
  readonly standIns: StandInTable
}

export type PieceTableTreeSnapshot = {
  // Storage maintenance may republish this with equal text; never key a cache on its identity.
  readonly buffers: PieceTableBuffers
  readonly root: PieceTreeNode | null
  readonly reverseIndex: PieceTableReverseIndex
  readonly length: number
  readonly pieceCount: number
  // The lineage epoch this snapshot was created in. Equal to the current epoch
  // means transient: editing it mutates its nodes, so it is consumed by that
  // edit. A second edit of a consumed snapshot is a contract violation.
  readonly epoch: number
  consumed: boolean
}

export type PieceTableEdit = {
  readonly from: number
  readonly to: number
  readonly text: string
}

export type PieceTableSnapshot = PieceTableTreeSnapshot
