import type {
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { TextMeasurer, canvasFont, renderedTabColumns } from './measure'
import { buildFrame, frameMoved, recolorFrame } from './morph-frame'
import { matchPieces } from './morph-match'
import {
  MorphRun,
  restingPieces,
  springEasing,
  type MorphTiming,
  type VisualPiece,
} from './morph-run'
import { drawableRows, reducedMotion, supportsLinearEasing, type TextOffsetRange } from './motion'
import { RowMoves, rowMoves, type ScreenShift } from './row-moves'
import {
  resolveTransitionOptions,
  type FileTransitionPluginOptions,
  type ResolvedTransitionOptions,
} from './transition-options'
import { RevealRun } from './reveal-run'
import { RowCover } from './row-cover'
import './style.css'

export type { FileTransitionMode, FileTransitionPluginOptions } from './transition-options'

const ACTIVE_CLASS = 'editor-file-transition-active'
// Input skips the reveal to its end. Scrolling does not: the overlay scrolls with the text.
const INPUT_EVENTS = ['keydown', 'pointerdown'] as const
// A reveal draws at most this many pieces; a denser viewport opens without one.
const MAX_PIECES = 4000
// One magic move, before the speed multiplier, and the spring overshoot of moving text.
const MAGIC_MOVE_MS = 640
const MAGIC_MOVE_BOUNCE = 0.18

/**
 * File-open "writes itself" animation. Including this plugin turns the effect on;
 * removing it turns it off. There is no command, setting, or UI — presence is the switch.
 */
export function createFileTransitionPlugin(
  options: FileTransitionPluginOptions = {},
): EditorPlugin {
  const resolved = resolveTransitionOptions(options)
  // Shared by every editor the plugin runs in: a magic move starts from the file opened last,
  // which may have been in another editor, such as the previous tab's.
  const handoff: Handoff = { last: null }
  return {
    name: 'editor.fileTransition',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) =>
          new FileTransitionViewContribution(viewContext, resolved, handoff),
      }),
  }
}

type Handoff = { last: LastFile | null }

/**
 * What a magic move reads of the previous file. Only these fields are kept: a whole snapshot would
 * hold its document session alive for as long as the plugin exists.
 */
type FileFrame = Pick<
  EditorViewSnapshot,
  'documentId' | 'visibleRows' | 'tokens' | 'gutterWidth' | 'viewport'
>

function fileFrame(snapshot: EditorViewSnapshot): FileFrame {
  const { documentId, visibleRows, tokens, gutterWidth, viewport } = snapshot
  return { documentId, visibleRows, tokens, gutterWidth, viewport }
}

function holdsOnlyText(frame: FileFrame) {
  return frame.visibleRows.every(
    (row) =>
      row.kind !== 'text' ||
      (typeof row.text === 'string' && row.chunks.every((chunk) => typeof chunk.text === 'string')),
  )
}

/** The file opened last, as its editor shows it now, and where that editor's viewport sat. */
type LastFile = {
  /** The editor showing it, until that editor goes. */
  readonly owner: FileTransitionViewContribution | null
  snapshot: FileFrame
  replaced: readonly TextOffsetRange[]
  viewport: ScreenPoint
}

type ScreenPoint = { readonly left: number; readonly top: number }

class FileTransitionViewContribution implements EditorViewContribution {
  public readonly inputs = ['content', 'tokens', 'viewport', 'layout', 'selection'] as const
  private animatedDocumentId: string | null = null
  private latestReplaced: readonly TextOffsetRange[] = []
  private run: RevealRun | MorphRun | null = null
  private moves: RowMoves | null = null
  /** The rows the overlay covers, when it covers only some. */
  private runRows: ReadonlySet<number> | undefined
  private runFrame: ReturnType<typeof buildFrame> = null
  private runSnapshot: EditorViewSnapshot | null = null
  private measurer: TextMeasurer | null = null
  private readonly cover: RowCover
  private readonly options: ResolvedTransitionOptions

  public constructor(
    private readonly context: EditorViewContributionContext,
    options: ResolvedTransitionOptions,
    private readonly handoff: Handoff,
  ) {
    this.cover = new RowCover(context)
    this.options = scaleTimings(options)
    this.latestReplaced = context.getInlineReplacementRanges()
    // Added to an editor already showing a file, the next open still has one to move from.
    if (context.hasDocument() && !handoff.last) this.remember(context.getSnapshot())
  }

  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind !== 'viewport') this.latestReplaced = this.context.getInlineReplacementRanges()
    if (kind === 'document') {
      const previous = this.handoff.last
      const other = previous?.snapshot.documentId === snapshot.documentId ? null : previous
      this.handleDocumentOpen(snapshot, other)
      if (snapshot.documentId) this.remember(snapshot)
      return
    }
    // The file opened last keeps up with its editor: its scroll and edits are where a move starts.
    // A tab switch clears the old editor first; the file it showed is still the one to move from.
    const last = this.handoff.last
    if (last?.owner === this && snapshot.documentId === last.snapshot.documentId) {
      last.snapshot = fileFrame(snapshot)
      last.replaced = this.latestReplaced
    }
    const started = this.runSnapshot
    if (!this.run || !started) return
    // New text or new metrics: the overlay no longer matches the rows under it.
    if (
      snapshot.textVersion !== started.textVersion ||
      frameMoved(started, snapshot, this.runRows)
    ) {
      this.finish()
      return
    }
    this.cover.refresh(snapshot)
    if (kind === 'tokens' && this.runFrame) {
      this.run.recolor(recolorFrame(this.runFrame, snapshot.tokens))
    }
  }

  public dispose(): void {
    this.finish()
    // The file stays the one to move from, but this editor and its view are let go. A row read
    // through its document (a long line) would keep that document alive, and a frame with one
    // cannot be drawn anyway, so such a file is not kept.
    const last = this.handoff.last
    if (last?.owner !== this) return
    this.handoff.last = holdsOnlyText(last.snapshot)
      ? { ...last, owner: null, viewport: this.viewportOrigin() ?? last.viewport }
      : null
  }

  /** Where this editor's viewport sits on screen, while it is on screen. */
  public viewportOrigin(): ScreenPoint | null {
    const element = this.context.scrollElement
    if (!element.isConnected) return null
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top }
  }

  private remember(snapshot: EditorViewSnapshot): void {
    // Only a magic move starts from the previous file; the reveals keep nothing.
    if (this.options.mode !== 'magicMove') return
    this.handoff.last = {
      owner: this,
      snapshot: fileFrame(snapshot),
      replaced: this.latestReplaced,
      viewport: this.viewportOrigin() ?? { left: 0, top: 0 },
    }
  }

  private handleDocumentOpen(snapshot: EditorViewSnapshot, previous: LastFile | null): void {
    const documentId = snapshot.documentId
    if (documentId !== null && documentId === this.animatedDocumentId) return
    // Any other document, empty or not, supersedes an in-flight reveal.
    this.finish()
    if (!documentId || snapshot.textSnapshot.length === 0) return
    if (reducedMotion(this.context)) return
    if (this.options.mode === 'magicMove') {
      this.animatedDocumentId = documentId
      this.magicMove(snapshot, previous)
      return
    }
    // Chips, hidden markup and phantom text are painted as something other than their source.
    if (this.context.getInlineReplacementRanges().length > 0) return
    this.animatedDocumentId = documentId
    const rows = this.cover.collect(snapshot)
    const measurer = this.ensureMeasurer(snapshot, rows[0]?.presentation.element)
    const frame = buildFrame(snapshot, measurer, MAX_PIECES, this.options.maxRows)
    if (!frame || frame.pieces.length === 0) {
      for (const row of rows) row.presentation.dispose()
      return
    }
    this.context.log({
      level: 'info',
      action: 'fileTransition.reveal',
      mode: this.options.mode,
      pieceCount: frame.pieces.length,
      rowCount: frame.rowCount,
      languageId: snapshot.languageId,
      highlightStatus: snapshot.initialHighlightStatus,
    })
    this.runFrame = frame
    this.runSnapshot = snapshot
    this.run = new RevealRun(
      this.context.contentElement,
      frame,
      this.options,
      (text) => measurer.width(text),
      () => this.finish(),
    )
    this.context.scrollElement.classList.add(ACTIVE_CLASS)
    this.cover.cover(rows)
    this.addInputListeners()
  }

  /**
   * The text the previous file shares with this one moves from where it stood on screen to where
   * it stands now; the rest of the old text leaves and the rest of the new enters. Rows painted as
   * something other than their source stay real and slide or fade in whole.
   */
  private magicMove(snapshot: EditorViewSnapshot, previous: LastFile | null): void {
    const drawn = drawableRows(snapshot, this.latestReplaced)
    const real = new Set(Array.from(snapshot.visibleRows, (row) => row.index))
    for (const index of drawn) real.delete(index)
    const shift = previous ? this.screenShift(previous, snapshot) : { dx: 0, dy: 0 }
    const { moves, taken } = rowMoves(previous?.snapshot ?? null, snapshot, real, shift)
    const rows = this.cover.collect(snapshot, drawn)
    const measurer = this.ensureMeasurer(snapshot, rows[0]?.presentation.element)
    const next = buildFrame(snapshot, measurer, MAX_PIECES, this.options.maxRows, (row) =>
      drawn.has(row.index),
    )
    const from = previous ? this.previousPieces(previous, measurer, taken, shift) : []
    if (!next || !from) {
      for (const row of rows) row.presentation.dispose()
      return
    }
    const timing: MorphTiming = {
      durationMs: MAGIC_MOVE_MS / this.options.speed,
      moveEasing: springEasing(MAGIC_MOVE_BOUNCE, supportsLinearEasing(this.context)),
    }
    const pairs = matchPieces(from, next.pieces)
    this.context.log({
      level: 'info',
      action: 'fileTransition.magicMove',
      pieceCount: next.pieces.length,
      movedCount: pairs.reduce((count, old) => count + (old >= 0 ? 1 : 0), 0),
      fromCount: from.length,
      languageId: snapshot.languageId,
    })
    this.runFrame = next
    this.runSnapshot = snapshot
    this.runRows = drawn
    // Rendered rows keep moving on their own after the overlay is done, which an overlay with no
    // pieces is at once.
    this.run = new MorphRun(this.context.contentElement, next, from, pairs, timing, () =>
      this.settleOverlay(),
    )
    this.moves = new RowMoves(this.context, moves, timing)
    this.context.scrollElement.classList.add(ACTIVE_CLASS)
    this.cover.cover(rows)
    this.addInputListeners()
  }

  /**
   * How far the previous file's content coordinates sit from this one's on screen: the two
   * viewports may be different editors, and each file has its own scroll and gutter.
   */
  private screenShift(previous: LastFile, snapshot: EditorViewSnapshot) {
    const before = previous.owner?.viewportOrigin() ?? previous.viewport
    const now = this.viewportOrigin() ?? before
    const old = previous.snapshot
    return {
      dx:
        before.left -
        now.left +
        old.gutterWidth -
        snapshot.gutterWidth +
        snapshot.viewport.scrollLeft -
        old.viewport.scrollLeft,
      dy: before.top - now.top + snapshot.viewport.scrollTop - old.viewport.scrollTop,
    }
  }

  /** The previous file's drawable text as resting pieces, placed where it stood on screen. */
  private previousPieces(
    previous: LastFile,
    measurer: TextMeasurer,
    moving: ReadonlySet<number>,
    shift: ScreenShift,
  ): VisualPiece[] | null {
    const drawn = drawableRows(previous.snapshot, previous.replaced)
    const frame = buildFrame(
      previous.snapshot,
      measurer,
      MAX_PIECES,
      this.options.maxRows,
      (row) => drawn.has(row.index) && !moving.has(row.index),
    )
    if (!frame) return null
    return restingPieces(frame).map((piece) => ({
      ...piece,
      x: piece.x + shift.dx,
      top: piece.top + shift.dy,
    }))
  }

  private finish(): void {
    this.moves?.cancel()
    this.moves = null
    this.settleOverlay()
  }

  private settleOverlay(): void {
    this.removeInputListeners()
    this.context.scrollElement.classList.remove(ACTIVE_CLASS)
    this.cover.showAll()
    this.run?.cancel()
    this.run = null
    this.runFrame = null
    this.runSnapshot = null
    this.runRows = undefined
  }

  private readonly finishOnInput = (): void => this.finish()

  private addInputListeners(): void {
    for (const type of INPUT_EVENTS) {
      this.context.scrollElement.addEventListener(type, this.finishOnInput, { capture: true })
    }
  }

  private removeInputListeners(): void {
    for (const type of INPUT_EVENTS) {
      this.context.scrollElement.removeEventListener(type, this.finishOnInput, { capture: true })
    }
  }

  private ensureMeasurer(snapshot: EditorViewSnapshot, fontSource: Element | undefined) {
    const font = canvasFont(fontSource ?? this.context.contentElement)
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
}

// Divide every time field by the speed multiplier (speed > 1 ⇒ shorter ⇒ faster).
function scaleTimings(options: ResolvedTransitionOptions): ResolvedTransitionOptions {
  return {
    ...options,
    perCharMs: options.perCharMs / options.speed,
    perTokenMs: options.perTokenMs / options.speed,
    maxDurationMs: options.maxDurationMs / options.speed,
    staggerMs: options.staggerMs / options.speed,
  }
}
