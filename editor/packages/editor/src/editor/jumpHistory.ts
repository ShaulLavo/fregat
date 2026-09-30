import {
  Anchor,
  anchorAt,
  resolveAnchor,
  type PieceTableAnchor,
  type PieceTableSnapshot,
} from '@singapore-editor/textbuffer'
import type { CursorHistoryEntry } from './cursorHistory'
import { sameCursorSelections } from './cursorHistory'

export type JumpCause = 'pointer' | 'find' | 'go-to-line' | 'provider'

type AnchoredPosition = {
  readonly before: PieceTableAnchor
  readonly after: PieceTableAnchor
}

type AnchoredSelection = {
  readonly anchor: AnchoredPosition
  readonly head: AnchoredPosition
  readonly affinity: 'before' | 'after'
}

export type JumpLocation = {
  readonly selections: readonly AnchoredSelection[]
  readonly lastAddedIndex: number
  readonly viewport: PieceTableAnchor
  readonly topDelta: number
  readonly scrollLeft: number
}

export type ResolvedJumpLocation = CursorHistoryEntry & {
  readonly viewportOffset: number
  readonly topDelta: number
}

export function captureJumpLocation(
  snapshot: PieceTableSnapshot,
  cursor: CursorHistoryEntry,
  viewportOffset: number,
  topDelta: number,
): JumpLocation {
  return {
    selections: cursor.selections.map((selection) => ({
      anchor: capturePosition(snapshot, selection.anchor),
      head: capturePosition(snapshot, selection.head),
      affinity: selection.affinity ?? 'after',
    })),
    lastAddedIndex: cursor.lastAddedIndex,
    viewport: anchorAt(snapshot, viewportOffset, snapshot.length === 0 ? 'left' : 'right'),
    topDelta,
    scrollLeft: cursor.scrollLeft,
  }
}

export function resolveJumpLocation(
  snapshot: PieceTableSnapshot,
  location: JumpLocation,
): ResolvedJumpLocation | null {
  const primary = location.selections[0]
  if (
    !primary ||
    resolvePosition(snapshot, primary.head) === null ||
    resolvePosition(snapshot, primary.anchor) === null
  )
    return null
  const selections: CursorHistoryEntry['selections'][number][] = []
  let lastAddedIndex = 0
  for (const [index, selection] of location.selections.entries()) {
    const anchor = resolvePosition(snapshot, selection.anchor)
    const head = resolvePosition(snapshot, selection.head)
    if (anchor === null || head === null) continue
    if (index === location.lastAddedIndex) lastAddedIndex = selections.length
    selections.push({ anchor, head, affinity: selection.affinity })
  }
  if (selections.length === 0) return null
  return {
    selections,
    lastAddedIndex,
    scrollLeft: location.scrollLeft,
    scrollTop: 0,
    viewportOffset: resolveAnchor(snapshot, location.viewport).offset,
    topDelta: location.topDelta,
  }
}

function capturePosition(snapshot: PieceTableSnapshot, offset: number): AnchoredPosition {
  return {
    before: offset === 0 ? Anchor.MIN : anchorAt(snapshot, offset, 'left'),
    after: offset === snapshot.length ? Anchor.MAX : anchorAt(snapshot, offset, 'right'),
  }
}

function resolvePosition(snapshot: PieceTableSnapshot, position: AnchoredPosition): number | null {
  const before = resolveAnchor(snapshot, position.before)
  if (before.liveness === 'live') return before.offset
  const after = resolveAnchor(snapshot, position.after)
  return after.liveness === 'live' ? after.offset : null
}

export class JumpHistory {
  private entries: JumpLocation[] = []
  private index = -1
  private walking = false

  clear(): void {
    this.entries = []
    this.index = -1
    this.walking = false
  }

  record(snapshot: PieceTableSnapshot, origin: JumpLocation, destination: JumpLocation): void {
    if (sameLocations(snapshot, origin, destination)) return
    this.entries.splice(this.index + 1)
    const last = this.entries.at(-1)
    if (!last || !sameLocations(snapshot, last, origin)) this.entries.push(origin)
    this.entries.push(destination)
    if (this.entries.length > 50) this.entries.splice(0, this.entries.length - 50)
    this.index = this.entries.length - 1
    this.walking = false
  }

  move(
    snapshot: PieceTableSnapshot,
    direction: 'back' | 'forward',
    current: JumpLocation,
  ): ResolvedJumpLocation | null {
    if (this.index < 0) return null
    if (!this.walking || !sameLocations(snapshot, this.entries[this.index]!, current))
      this.entries[this.index] = current
    const step = direction === 'back' ? -1 : 1
    for (let index = this.index + step; index >= 0 && index < this.entries.length; index += step) {
      const location = this.entries[index]!
      const resolved = resolveJumpLocation(snapshot, location)
      if (!resolved || sameLocations(snapshot, location, current)) continue
      this.index = index
      this.walking = true
      return resolved
    }
    return null
  }
}

function sameLocations(
  snapshot: PieceTableSnapshot,
  left: JumpLocation,
  right: JumpLocation,
): boolean {
  const a = resolveJumpLocation(snapshot, left)
  const b = resolveJumpLocation(snapshot, right)
  return a !== null && b !== null && sameCursorSelections(a, b)
}
