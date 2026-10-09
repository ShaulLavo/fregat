import type { PaintedTextFrame } from '../render/painted-text-frame.js'
import type {
  TerminalSubmission,
  TerminalSubmittedFrame,
  TerminalSubmittedRow,
  TerminalSubmittedSnapshot,
} from './submitted-frame.js'

interface PaintedText {
  readonly painted: PaintedTextFrame
  readonly sameLayout: boolean
  rows?: readonly TerminalSubmittedRow[]
  rowPatches?: readonly TerminalSubmittedRow[]
}

/** Private DOM metadata; public text materializes through shared accessors. */
export class PaintedSubmission implements TerminalSubmittedSnapshot {
  readonly frame: number
  readonly nativeRevision: number
  readonly snapshotVersion: TerminalSubmittedFrame['snapshotVersion']
  readonly layout: number
  readonly grid: TerminalSubmittedFrame['grid']
  readonly font: TerminalSubmittedFrame['font']
  readonly padding: TerminalSubmittedFrame['padding']
  readonly theme: TerminalSubmittedFrame['theme']
  readonly cursor: TerminalSubmittedFrame['cursor']
  readonly paintedCursor: TerminalSubmittedFrame['paintedCursor']
  readonly selection: TerminalSubmittedFrame['selection']
  readonly scrollbar: TerminalSubmittedFrame['scrollbar']
  readonly #text: PaintedText

  constructor(
    previous: TerminalSubmittedSnapshot | undefined,
    input: TerminalSubmission,
    painted: PaintedTextFrame,
    retained?: PaintedSubmission,
  ) {
    this.frame = retained?.frame ?? (previous?.frame ?? 0) + 1
    this.nativeRevision = input.nativeRevision
    this.snapshotVersion = input.snapshotVersion
    this.layout = input.layout
    this.grid = Object.freeze({ ...input.grid })
    this.font = input.font
    this.padding = Object.freeze({ ...input.padding })
    this.theme = input.theme
    // The private DOM renderer already owns these frozen cursor values.
    this.cursor = input.snapshot.cursor
    this.paintedCursor = input.snapshot.paintedCursor
    this.selection = input.selection
      ? Object.freeze({
          ...input.selection,
          start: Object.freeze({ ...input.selection.start }),
          end: Object.freeze({ ...input.selection.end }),
        })
      : undefined
    this.scrollbar = Object.freeze({ ...input.scrollbar })
    this.#text = retained
      ? retained.#text
      : {
          painted,
          sameLayout: previous?.layout === input.layout,
          rows: undefined,
          rowPatches: undefined,
        }
    Object.freeze(this)
  }

  get rows(): readonly TerminalSubmittedRow[] {
    this.materialize()
    return this.#text.rows!
  }

  get rowPatches(): readonly TerminalSubmittedRow[] {
    this.materialize()
    return this.#text.rowPatches!
  }

  withRevision(nativeRevision: number): PaintedSubmission {
    return new PaintedSubmission(
      undefined,
      {
        ...this,
        nativeRevision,
        snapshot: { cursor: this.cursor, paintedCursor: this.paintedCursor, rows: [] },
      },
      this.#text.painted,
      this,
    )
  }

  private materialize(): void {
    const text = this.#text
    if (text.rows) return
    const previous = text.sameLayout ? text.painted.previousRows : []
    const patches: TerminalSubmittedRow[] = []
    text.rows = Object.freeze(
      text.painted.rows.map((row) => {
        const old = previous[row.y]
        if (old?.y === row.y && old.text === row.text) return old
        const owned = Object.freeze({ y: row.y, text: row.text })
        patches.push(owned)
        return owned
      }),
    )
    text.rowPatches = Object.freeze(patches)
  }
}
