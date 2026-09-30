import {
  anchorAfter,
  type PieceTableAnchor as Anchor,
  type PieceTableSnapshot,
  readPieceTableTextRange,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

type TrackedPair = {
  readonly closerAnchor: Anchor
  readonly closerChar: string
}

/** Bounded so a long session cannot accumulate entries; oldest first. */
const MAX_TRACKED_PAIRS = 32

/**
 * Remembers which closing characters *this editor* inserted, so type-over and pair-backspace only
 * ever touch text the user did not type.
 *
 * Validity is keyed on snapshot object identity rather than a list of invalidating events.
 * Snapshots are immutable and every commit produces a new one, so undo, redo, a second view session
 * on the same buffer, programmatic edits, and file reloads all invalidate for free — including the
 * ones this class could never be told about, since nothing in core subscribes to buffer changes.
 */
export class AutoCloseStore {
  private validForSnapshot: PieceTableSnapshot | null = null
  private pairs: TrackedPair[] = []

  /** Records a closer inserted at `offset` in `snapshot`. */
  track(snapshot: PieceTableSnapshot, offset: number, closerChar: string): void {
    this.adoptSnapshot(snapshot)
    // Right bias: text typed between the delimiters must push the closer along, which is exactly
    // what makes type-over still work after editing inside the pair.
    this.pairs.push({ closerAnchor: anchorAfter(snapshot, offset), closerChar })
    if (this.pairs.length > MAX_TRACKED_PAIRS) this.pairs.shift()
  }

  /**
   * True when `offset` sits immediately before a tracked closer that is still present.
   *
   * The store is never trusted on its own: the anchor must still be live and the document must
   * still hold that character there, both O(1).
   */
  hasCloserAt(snapshot: PieceTableSnapshot, offset: number, closerChar: string): boolean {
    if (this.validForSnapshot !== snapshot) return false

    return this.pairs.some((pair) => {
      if (pair.closerChar !== closerChar) return false

      const resolved = resolveAnchor(snapshot, pair.closerAnchor)
      if (resolved.liveness !== 'live') return false
      if (resolved.offset !== offset) return false

      return characterAt(snapshot, offset) === closerChar
    })
  }

  /** Drops the tracked closer at `offset`, once it has been stepped over or deleted. */
  forget(snapshot: PieceTableSnapshot, offset: number): void {
    if (this.validForSnapshot !== snapshot) return

    this.pairs = this.pairs.filter((pair) => {
      const resolved = resolveAnchor(snapshot, pair.closerAnchor)
      return resolved.liveness === 'live' && resolved.offset !== offset
    })
  }

  /**
   * Carries the store onto the snapshot this editor just produced. Anything that arrives on a
   * snapshot we did not hand forward — paste, undo, an edit from another view — leaves the store
   * behind and it clears on the next read.
   */
  advance(snapshot: PieceTableSnapshot): void {
    if (this.validForSnapshot === null) return

    this.validForSnapshot = snapshot
  }

  clear(): void {
    this.validForSnapshot = null
    this.pairs = []
  }

  private adoptSnapshot(snapshot: PieceTableSnapshot): void {
    if (this.validForSnapshot === snapshot) return

    this.validForSnapshot = snapshot
    this.pairs = []
  }
}

/**
 * Character at `offset`, or null at the document edges.
 *
 * Clamped because readPieceTableTextRange throws out of range, which would otherwise fire on the
 * first character typed into an empty file.
 */
export function characterAt(snapshot: PieceTableSnapshot, offset: number): string | null {
  if (offset < 0 || offset >= snapshot.length) return null

  return readPieceTableTextRange(snapshot, offset, offset + 1)
}

export function characterBefore(snapshot: PieceTableSnapshot, offset: number): string | null {
  return characterAt(snapshot, offset - 1)
}
