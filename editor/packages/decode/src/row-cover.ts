import type {
  EditorRowPresentation,
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'

/** A mounted row's handle, with the display row it was taken for. */
export type CoveredRow = {
  readonly index: number
  readonly presentation: EditorRowPresentation
}

type HiddenRow = {
  readonly index: number
  readonly presentation: EditorRowPresentation
  readonly animation: Animation
}

/**
 * Hides the editor's real rows while an overlay draws them. The rows stay mounted and laid out; a
 * held opacity animation hides each one without touching styles the editor owns.
 *
 * The cover is kept per display row, not per element: when the editor repaints a covered row (a
 * provisional paint becoming live, a highlight pass) its handle aborts, and `refresh` hides the
 * new element in the same render pass, before it can paint. Rows scrolled in mid-animation were
 * never covered, so they show as normal.
 */
export class RowCover {
  private readonly hidden = new Map<HTMLElement, HiddenRow>()
  private covered = new Set<number>()

  public constructor(private readonly context: EditorViewContributionContext) {}

  /** The mounted rows' handles, so a caller can read from them before anything writes. */
  public collect(snapshot: EditorViewSnapshot): CoveredRow[] {
    const rows: CoveredRow[] = []
    for (const row of snapshot.visibleRows) {
      const presentation = this.context.getRowPresentation(row.index)
      if (presentation) rows.push({ index: row.index, presentation })
    }
    return rows
  }

  /** Covers exactly `rows`: any row covered before and missing now shows again. */
  public cover(rows: readonly CoveredRow[]): void {
    this.covered = new Set(rows.map((row) => row.index))
    for (const [element, entry] of this.hidden) {
      if (!this.covered.has(entry.index)) this.show(element, entry)
    }
    for (const row of rows) this.hide(row)
  }

  /** Hides covered rows the editor has repainted since; call from every update while covering. */
  public refresh(snapshot: EditorViewSnapshot): void {
    if (this.covered.size === 0) return
    const hiddenRows = new Set(Array.from(this.hidden.values(), (entry) => entry.index))
    for (const row of snapshot.visibleRows) {
      if (!this.covered.has(row.index) || hiddenRows.has(row.index)) continue
      const presentation = this.context.getRowPresentation(row.index)
      if (presentation) this.hide({ index: row.index, presentation })
    }
  }

  public showAll(): void {
    this.covered = new Set()
    for (const [element, entry] of this.hidden) this.show(element, entry)
  }

  private hide(row: CoveredRow): void {
    const element = row.presentation.element
    if (this.hidden.has(element)) {
      row.presentation.dispose()
      return
    }
    const animation = element.animate([{ opacity: 0 }, { opacity: 0 }], {
      duration: Number.POSITIVE_INFINITY,
      fill: 'both',
    })
    const entry = { index: row.index, presentation: row.presentation, animation }
    this.hidden.set(element, entry)
    row.presentation.signal.addEventListener('abort', () => this.show(element, entry), {
      once: true,
    })
  }

  private show(element: HTMLElement, entry: HiddenRow): void {
    if (this.hidden.get(element) !== entry) return
    this.hidden.delete(element)
    entry.animation.cancel()
    entry.presentation.dispose()
  }
}
