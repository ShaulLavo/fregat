import type {
  EditorContributionChange,
  EditorDisposable,
  EditorPlugin,
  EditorRowPresentation,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { TextMeasurer, canvasFont, renderedTabColumns } from './measure'
import { buildFrame, recolorFrame, type MorphFrame } from './morph-frame'
import { matchPieces } from './morph-match'
import { MorphRun, restingPieces, springEasing, type MorphTiming } from './morph-run'
import './style.css'

export type MorphPluginOptions = {
  /** Length of one morph in milliseconds. Defaults to `520`. */
  readonly durationMs?: number
  /** Spring overshoot of moving text, from `0` (none) to `0.5`. Defaults to `0.18`. */
  readonly bounce?: number
  /**
   * Smallest edit, in characters inserted plus removed, that morphs. Undo, redo,
   * checkout and reconcile always morph. Defaults to `8`, so typing stays instant.
   */
  readonly minEditChars?: number
  /** Safety cap on pieces drawn; a larger viewport skips the morph. Defaults to `2500`. */
  readonly maxPieces?: number
}

const ACTIVE_CLASS = 'editor-morph-active'
const ALWAYS_MORPH = new Set(['undo', 'redo', 'checkout', 'reconcile'])
const TEXT_CHANGES = new Set(['edit', 'undo', 'redo', 'checkout', 'reconcile'])

/**
 * Text changes animate from the old text to the new: text that survives the
 * change slides to its new place, removed text fades out, and new text streams
 * in. Including this plugin turns the effect on.
 */
export function createMorphPlugin(options: MorphPluginOptions = {}): EditorPlugin {
  const resolved = {
    durationMs: positive(options.durationMs, 520),
    bounce: Math.min(0.5, Math.max(0, options.bounce ?? 0.18)),
    minEditChars: Math.max(0, options.minEditChars ?? 8),
    maxPieces: positive(options.maxPieces, 2500),
  }
  return {
    name: 'editor.morph',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) => new MorphViewContribution(viewContext, resolved),
      }),
  }
}

type ResolvedMorphOptions = {
  readonly durationMs: number
  readonly bounce: number
  readonly minEditChars: number
  readonly maxPieces: number
}

type HiddenRow = {
  readonly presentation: EditorRowPresentation
  readonly animation: Animation
}

class MorphViewContribution implements EditorViewContribution {
  public readonly inputs = ['content', 'tokens', 'viewport', 'layout'] as const
  private latest: EditorViewSnapshot | null = null
  /** The last snapshot of the text before `latest`'s, which a change morphs from. */
  private before: EditorViewSnapshot | null = null
  private measurer: TextMeasurer | null = null
  private run: MorphRun | null = null
  private readonly hidden = new Map<HTMLElement, HiddenRow>()
  private timing: MorphTiming | null = null
  private readonly typing: EditorDisposable

  public constructor(
    private readonly context: EditorViewContributionContext,
    private readonly options: ResolvedMorphOptions,
  ) {
    // Added to an editor that already shows a document, the first change still needs its before.
    if (context.hasDocument()) this.latest = context.getSnapshot()
    // Typed text shows at once: a keystroke settles any morph instead of joining it.
    this.typing = context.onDidType(() => this.finish())
  }

  public update(
    snapshot: EditorViewSnapshot,
    kind: EditorViewContributionUpdateKind,
    change?: EditorContributionChange | null,
  ): void {
    // One pass can deliver the new text under several kinds, `viewport` before `content`.
    if (this.latest && this.latest.textVersion !== snapshot.textVersion) this.before = this.latest
    this.latest = snapshot
    const previous = this.before
    if (kind === 'document' || kind === 'clear') {
      this.finish()
      return
    }
    if (kind === 'layout') {
      // New metrics or wrapping: the overlay's coordinates no longer match the rows.
      this.measurer = null
      this.finish()
      return
    }
    if (kind === 'tokens' && this.run) {
      this.run.recolor(recolorFrame(this.run.targetFrame, snapshot.tokens))
      return
    }
    if (kind !== 'content' || !previous || previous.textVersion === snapshot.textVersion) return
    if (change && !TEXT_CHANGES.has(change.kind)) return
    if (!this.shouldMorph(previous, snapshot, change ?? null)) {
      this.finish()
      return
    }
    this.morph(previous, snapshot)
  }

  public dispose(): void {
    this.typing.dispose()
    this.finish()
  }

  private shouldMorph(
    previous: EditorViewSnapshot,
    snapshot: EditorViewSnapshot,
    change: EditorContributionChange | null,
  ): boolean {
    if (reducedMotion(this.context)) return false
    if (previous.documentId !== snapshot.documentId) return false
    // `setContent` on an editor without a session re-renders the whole text with no change record.
    if (!change) return true
    if (ALWAYS_MORPH.has(change.kind)) return true
    // A small edit landing mid-morph joins it, so streamed text never snaps the motion to its end.
    if (this.run) return true
    return changedChars(change) >= this.options.minEditChars
  }

  private morph(previous: EditorViewSnapshot, snapshot: EditorViewSnapshot): void {
    // Chips, hidden markup and phantom text are painted as something other than their source.
    if (this.context.getInlineReplacementRanges().length > 0) {
      this.finish()
      return
    }
    const rows = this.collectRows(snapshot)
    const measurer = this.ensureMeasurer(snapshot, rows)
    const next = buildFrame(snapshot, measurer, this.options.maxPieces)
    const from = this.run ? this.run.visualPieces() : this.restingFrom(previous, measurer)
    if (!next || !from) {
      for (const row of rows) row.dispose()
      this.finish()
      return
    }
    const pairs = matchPieces(
      from.map((piece) => piece.text),
      next.pieces.map((piece) => piece.text),
    )

    this.run?.cancel()
    this.run = new MorphRun(
      this.context.contentElement,
      next,
      from,
      pairs,
      this.ensureTiming(),
      () => this.finish(),
    )
    this.context.scrollElement.classList.add(ACTIVE_CLASS)
    this.hideRows(rows)
    this.context.log({
      level: 'info',
      action: 'morph.start',
      pieceCount: next.pieces.length,
      movedCount: pairs.reduce((count, old) => count + (old >= 0 ? 1 : 0), 0),
      fromCount: from.length,
    })
  }

  private restingFrom(previous: EditorViewSnapshot, measurer: TextMeasurer) {
    const frame: MorphFrame | null = buildFrame(previous, measurer, this.options.maxPieces)
    return frame ? restingPieces(frame) : null
  }

  private collectRows(snapshot: EditorViewSnapshot): EditorRowPresentation[] {
    const rows: EditorRowPresentation[] = []
    for (const row of snapshot.visibleRows) {
      const presentation = this.context.getRowPresentation(row.index)
      if (presentation) rows.push(presentation)
    }
    return rows
  }

  // The real rows stay mounted and laid out underneath; a held opacity animation hides each one
  // without touching styles the editor owns. A row the editor replaces or recycles shows again.
  private hideRows(rows: readonly EditorRowPresentation[]): void {
    for (const presentation of rows) {
      const element = presentation.element
      if (this.hidden.has(element)) {
        presentation.dispose()
        continue
      }
      const animation = element.animate([{ opacity: 0 }, { opacity: 0 }], {
        duration: Number.POSITIVE_INFINITY,
        fill: 'both',
      })
      const entry = { presentation, animation }
      this.hidden.set(element, entry)
      presentation.signal.addEventListener('abort', () => this.showRow(element, entry), {
        once: true,
      })
    }
  }

  private showRow(element: HTMLElement, entry: HiddenRow): void {
    if (this.hidden.get(element) !== entry) return
    this.hidden.delete(element)
    entry.animation.cancel()
    entry.presentation.dispose()
  }

  private finish(): void {
    this.context.scrollElement.classList.remove(ACTIVE_CLASS)
    for (const [element, entry] of this.hidden) this.showRow(element, entry)
    this.run?.cancel()
    this.run = null
  }

  private ensureMeasurer(
    snapshot: EditorViewSnapshot,
    rows: readonly EditorRowPresentation[],
  ): TextMeasurer {
    const fontSource = rows[0]?.element ?? this.context.contentElement
    const font = canvasFont(fontSource)
    const tabColumns = renderedTabColumns(this.context.scrollElement, snapshot.tabSize)
    if (this.measurer?.font === font && this.measurer.tabColumns === tabColumns)
      return this.measurer
    this.measurer = new TextMeasurer(
      this.context.scrollElement.ownerDocument,
      font,
      snapshot.metrics.characterWidth,
      tabColumns,
    )
    return this.measurer
  }

  private ensureTiming(): MorphTiming {
    this.timing ??= {
      durationMs: this.options.durationMs,
      moveEasing: springEasing(this.options.bounce, supportsLinearEasing(this.context)),
    }
    return this.timing
  }
}

function changedChars(change: EditorContributionChange): number {
  let total = 0
  for (const edit of change.edits) total += edit.to - edit.from + edit.text.length
  return total
}

function positive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback
  return value
}

function reducedMotion(context: EditorViewContributionContext): boolean {
  const view = context.scrollElement.ownerDocument.defaultView
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function supportsLinearEasing(context: EditorViewContributionContext): boolean {
  const css = context.scrollElement.ownerDocument.defaultView?.CSS
  return css?.supports?.('animation-timing-function', 'linear(0, 1)') ?? false
}
