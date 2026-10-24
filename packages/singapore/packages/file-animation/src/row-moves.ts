import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { MorphTiming } from './morph-run'

type VisibleRow = EditorViewSnapshot['visibleRows'][number]

/**
 * Rows the overlay cannot redraw, such as rendered Markdown, animated as whole real rows: a row
 * whose text was on screen before slides from where it stood, and a new one fades in. The `translate`
 * property composes with however the editor positions the row.
 */
export class RowMoves {
  private readonly releases: (() => void)[] = []

  public constructor(
    context: EditorViewContributionContext,
    rows: readonly RowMove[],
    timing: MorphTiming,
  ) {
    for (const move of rows) {
      const presentation = context.getRowPresentation(move.index)
      if (!presentation) continue
      const animation = animateRow(presentation.element, move, timing)
      if (!animation) {
        presentation.dispose()
        continue
      }
      // A recycled row element shows other text; the motion stops with the row it was for.
      const release = () => {
        animation.cancel()
        presentation.dispose()
      }
      presentation.signal.addEventListener('abort', release, { once: true })
      animation.finished.then(
        () => presentation.dispose(),
        () => undefined,
      )
      this.releases.push(release)
    }
  }

  public cancel(): void {
    for (const release of this.releases) release()
    this.releases.length = 0
  }
}

/** A real row to animate: from `offset` away when its text stood there before, else entering. */
export type RowMove = {
  readonly index: number
  readonly offset: { readonly dx: number; readonly dy: number } | null
}

/** How far `before`'s content coordinates sit from `after`'s on screen. */
export type ScreenShift = { readonly dx: number; readonly dy: number }

function animateRow(element: HTMLElement, move: RowMove, timing: MorphTiming): Animation | null {
  if (move.offset === null) {
    return element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration: timing.durationMs,
      easing: 'ease-out',
    })
  }
  const { dx, dy } = move.offset
  if (dx === 0 && dy === 0) return null
  return element.animate([{ translate: `${dx}px ${dy}px` }, { translate: '0 0' }], {
    duration: timing.durationMs,
    easing: timing.moveEasing,
  })
}

/**
 * Pairs each of `rows` in `after` with the row in `before` that held the same text, nearest
 * first, so a moved block of rendered rows slides together. `shift` moves `before`'s rows into
 * `after`'s coordinates: another editor, scroll position or gutter. Returns the pairs and the old
 * rows they took, which the overlay must leave out.
 */
export function rowMoves(
  before: Pick<EditorViewSnapshot, 'visibleRows'> | null,
  after: EditorViewSnapshot,
  rows: ReadonlySet<number>,
  shift: ScreenShift = { dx: 0, dy: 0 },
): { readonly moves: RowMove[]; readonly taken: Set<number> } {
  const byText = new Map<string, VisibleRow[]>()
  for (const row of before?.visibleRows ?? []) {
    if (row.kind !== 'text' || typeof row.text !== 'string') continue
    const list = byText.get(row.text)
    if (list) list.push(row)
    else byText.set(row.text, [row])
  }
  const taken = new Set<number>()
  const moves: RowMove[] = []
  for (const row of after.visibleRows) {
    if (!rows.has(row.index) || row.kind !== 'text' || typeof row.text !== 'string') continue
    const old = nearestFree(byText.get(row.text), row.top - shift.dy, taken)
    if (old) taken.add(old.index)
    const offset = old ? { dx: shift.dx, dy: old.top + shift.dy - row.top } : null
    moves.push({ index: row.index, offset })
  }
  return { moves, taken }
}

function nearestFree(
  candidates: readonly VisibleRow[] | undefined,
  top: number,
  taken: ReadonlySet<number>,
): VisibleRow | null {
  let best: VisibleRow | null = null
  for (const candidate of candidates ?? []) {
    if (taken.has(candidate.index)) continue
    if (!best || Math.abs(candidate.top - top) < Math.abs(best.top - top)) best = candidate
  }
  return best
}
