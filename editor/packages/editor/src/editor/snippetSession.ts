import {
  anchorAfter,
  anchorBefore,
  type PieceTableAnchor as Anchor,
  type PieceTableSnapshot,
  resolveAnchor,
} from '@singapore-editor/textbuffer'

import type { TextEdit } from '../tokens'

export type SnippetStopRange = {
  readonly start: number
  readonly end: number
}

/**
 * A second place the same stop is written. `transform` renders it from the stop's text; without one
 * it holds that text verbatim.
 */
export type SnippetMirrorRange = SnippetStopRange & {
  readonly transform?: (value: string) => string
}

export type SnippetSessionStop = SnippetStopRange & {
  readonly mirrors?: readonly SnippetMirrorRange[]
}

/** A stop as it stands in the document now: where its caret goes, and where its copies are. */
export type ActiveSnippetStop = {
  readonly range: SnippetStopRange
  readonly mirrors: readonly SnippetMirrorRange[]
}

type TrackedRange = {
  readonly startAnchor: Anchor
  readonly endAnchor: Anchor
}

type TrackedMirror = TrackedRange & {
  readonly transform?: (value: string) => string
}

type TrackedStop = {
  readonly caret: TrackedRange
  readonly mirrors: readonly TrackedMirror[]
}

/**
 * The tab stops of the snippet currently being filled in.
 *
 * Stops are anchors, so typing inside one carries the later stops along. Validity is keyed on
 * snapshot object identity, exactly as the auto-close store is: undo, redo, a programmatic edit, or
 * an edit from another view all produce a snapshot this session was never advanced onto, and it
 * goes quiet rather than moving the caret somewhere stale.
 */
export class SnippetSession {
  private validForSnapshot: PieceTableSnapshot | null = null
  private stops: TrackedStop[] = []
  private cursor = 0

  start(snapshot: PieceTableSnapshot, stops: readonly SnippetSessionStop[]): void {
    // One stop with nothing copying it is where the caret already is: nothing to cycle through and
    // nothing to keep in step. One stop with copies still has to be tracked, because those copies
    // are rewritten from it on every keystroke.
    if (stops.length <= 1 && !stops.some((stop) => stop.mirrors && stop.mirrors.length > 0)) {
      this.clear()
      return
    }

    this.validForSnapshot = snapshot
    this.stops = stops.map((stop) => ({
      caret: trackedRange(snapshot, stop),
      mirrors: (stop.mirrors ?? []).map((mirror) => trackedMirror(snapshot, mirror)),
    }))
    this.cursor = 0
  }

  get active(): boolean {
    return this.stops.length > 0
  }

  /** Advances to the next or previous stop and returns its range, or null when there is none. */
  move(snapshot: PieceTableSnapshot, direction: 1 | -1): SnippetStopRange | null {
    if (this.validForSnapshot !== snapshot) {
      this.clear()
      return null
    }

    // A stop whose anchors are gone is stepped over rather than taken as the end of the session:
    // filling in a placeholder replaces the text any placeholder nested in it was anchored on, and
    // the stops after that one are still exactly where the snippet put them.
    for (
      let next = this.cursor + direction;
      next >= 0 && next < this.stops.length;
      next += direction
    ) {
      const stop = this.stops[next]
      const range = stop ? resolveRange(snapshot, stop.caret) : null
      if (!range) continue

      this.cursor = next
      return range
    }

    // Walking off either end ends the session, so the next Tab indents as usual.
    this.clear()
    return null
  }

  /**
   * The stop the caret is on, with every copy of it, or null when any of them no longer describes
   * the document — a copy resolved from a stale offset would be rewritten over the wrong text.
   */
  activeStop(snapshot: PieceTableSnapshot): ActiveSnippetStop | null {
    if (this.validForSnapshot !== snapshot) return null

    const stop = this.stops[this.cursor]
    if (!stop) return null

    const range = resolveRange(snapshot, stop.caret)
    if (!range) return null

    const mirrors: SnippetMirrorRange[] = []
    for (const tracked of stop.mirrors) {
      const mirror = resolveRange(snapshot, tracked)
      if (!mirror) return null

      mirrors.push(tracked.transform ? { ...mirror, transform: tracked.transform } : mirror)
    }

    return { mirrors, range }
  }

  /**
   * Re-anchors the active stop where the edit that just ran left it.
   *
   * Rewriting a copy replaces the whole of it, which deletes the very text its anchors were taken
   * in; resolved afterwards they report themselves gone, and the stop would lose its copies from
   * the second keystroke on. The offsets the edit was built from are what the anchors are taken
   * again at.
   */
  reanchor(snapshot: PieceTableSnapshot, stop: ActiveSnippetStop): void {
    if (this.validForSnapshot === null) return
    if (!this.stops[this.cursor]) return

    this.validForSnapshot = snapshot
    this.stops[this.cursor] = {
      caret: trackedRange(snapshot, stop.range),
      mirrors: stop.mirrors.map((mirror) => trackedMirror(snapshot, mirror)),
    }
  }

  /**
   * Keeps the session alive across an edit this editor itself produced, carrying the stop the edit
   * landed in through it.
   *
   * A stop is anchored on the characters at either end of its placeholder, and replacing the
   * placeholder — which is how a placeholder is filled in — deletes both of them. A stop with
   * copies is re-anchored by the batch that rewrote them, in the coordinates that batch produced; a
   * stop with none never reaches that batch, and resolved against the document the edit produced it
   * reports itself gone for the rest of the session. Nothing on screen says so: Shift+Tab walks off
   * the end over it and the stops behind it are simply never reachable again. So where the edits
   * left its text is worked out from the edits themselves, and the anchors are taken again there.
   */
  advance(snapshot: PieceTableSnapshot, edits: readonly TextEdit[] = []): void {
    if (this.validForSnapshot === null) return

    const carried = this.carriedStopRange(snapshot, edits)
    this.validForSnapshot = snapshot
    if (!carried) return

    this.stops[this.cursor] = { caret: trackedRange(snapshot, carried), mirrors: [] }
  }

  /** Where the edits left the active stop, asked only of one they have just untracked. */
  private carriedStopRange(
    snapshot: PieceTableSnapshot,
    edits: readonly TextEdit[],
  ): SnippetStopRange | null {
    const previous = this.validForSnapshot
    if (!previous || edits.length === 0) return null

    const stop = this.stops[this.cursor]
    if (!stop || stop.mirrors.length > 0) return null
    // Only a stop the edits actually took away is moved by hand: anchors that survived carry the
    // bias the stop was placed with, which is more than a set of offsets can say.
    if (resolveRange(snapshot, stop.caret)) return null

    const before = resolveRange(previous, stop.caret)
    if (!before) return null

    return rangeAfterEdits(before, edits)
  }

  clear(): void {
    this.validForSnapshot = null
    this.stops = []
    this.cursor = 0
  }
}

/**
 * Anchors biased inward, so text typed against either end of a range lands outside it: what a
 * reader types up against a stop is the text around the snippet, not more of the placeholder.
 */
function trackedRange(snapshot: PieceTableSnapshot, range: SnippetStopRange): TrackedRange {
  return {
    endAnchor: anchorBefore(snapshot, range.end),
    startAnchor: anchorAfter(snapshot, range.start),
  }
}

function trackedMirror(snapshot: PieceTableSnapshot, mirror: SnippetMirrorRange): TrackedMirror {
  const tracked = trackedRange(snapshot, mirror)
  return mirror.transform ? { ...tracked, transform: mirror.transform } : tracked
}

/**
 * A range carried through a batch of edits, every one of them expressed against the document as it
 * stood before them, or null when an edit crosses one of its ends.
 *
 * An edit that is half inside the stop and half outside it is not the placeholder being filled in,
 * and guessing where such an edit left it would put the stop somewhere the reader never typed —
 * worse than losing it. The ends themselves follow the bias the stop is tracked with: text written
 * at either of them is the document around the snippet, so it moves the stop rather than joining it.
 */
function rangeAfterEdits(
  range: SnippetStopRange,
  edits: readonly TextEdit[],
): SnippetStopRange | null {
  let { end, start } = range
  for (const edit of edits) {
    const grew = edit.text.length - (edit.to - edit.from)
    if (edit.to <= start) {
      start += grew
      end += grew
      continue
    }
    if (edit.from >= end) continue
    if (edit.from < start || edit.to > end) return null

    end += grew
  }

  return { end, start }
}

function resolveRange(
  snapshot: PieceTableSnapshot,
  tracked: TrackedRange,
): SnippetStopRange | null {
  const start = resolveAnchor(snapshot, tracked.startAnchor)
  const end = resolveAnchor(snapshot, tracked.endAnchor)
  if (start.liveness !== 'live' || end.liveness !== 'live') return null
  if (end.offset < start.offset) return null

  return { end: end.offset, start: start.offset }
}
