import type { EditorViewSnapshot } from '@singapore-editor/core/extensions'

import type { OffsetRange } from './offsetRange'
import type { TooltipPart } from './tooltip'

export { EDITOR_HOVER_PARTICIPANT, EDITOR_HOVER_PARTICIPANT_ID } from './hoverToken'

/** Where the hover is being asked about. */
export type HoverAnchor = {
  readonly offset: number
  /** The identifier under the offset, or the single character there. */
  readonly range: OffsetRange
  readonly source: 'pointer' | 'keyboard'
  /**
   * Where the pointer is, for a participant whose subject is a painted element rather than text:
   * a zero-width character's marker has an extent the text offset does not.
   */
  readonly point?: { readonly clientX: number; readonly clientY: number }
}

export type HoverRequest = {
  readonly anchor: HoverAnchor
  readonly snapshot: EditorViewSnapshot
  /** Aborted the moment the hover moves on; an answer after that is never shown. */
  readonly signal: AbortSignal
}

/** One thing a participant has to say. The hover shows every part of every participant at once. */
export type HoverPart = TooltipPart & {
  /** Lower comes first. Parts from one participant keep the order they were emitted in. */
  readonly ordinal: number
  /** The text this part is about; the hover anchors to the union of its parts' ranges. */
  readonly range: OffsetRange
}

/**
 * A source of hover content. The hover controller owns the pointer, the delay and the surface; a
 * participant only answers what is at a position. Modeled on VS Code's hover participants: sync
 * answers come from what is already in the view (markers, decorations), async ones from a server.
 */
export type EditorHoverParticipant = {
  /** Asked once the pointer has settled. Cheap: it runs on the main thread at reveal time. */
  computeSync?(request: HoverRequest): readonly HoverPart[]
  /**
   * Started halfway through the delay so network time overlaps the rest of the dwell. `emit`
   * replaces this participant's async parts, so a progressive answer shows as it grows. Resolves
   * when the participant has nothing more to add.
   */
  computeAsync?(request: HoverRequest, emit: (parts: readonly HoverPart[]) => void): Promise<void>
}
