import type {
  EditorPlugin,
  EditorViewContribution,
  EditorViewContributionContext,
  EditorViewContributionUpdateKind,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import { TextMeasurer, canvasFont, renderedTabColumns } from './measure'
import { buildFrame, frameMoved, recolorFrame } from './morph-frame'
import {
  resolveDecodeOptions,
  type DecodePluginOptions,
  type ResolvedDecodeOptions,
} from './options'
import { RevealRun } from './reveal-run'
import { RowCover } from './row-cover'
import './style.css'

export type { DecodeMode, DecodePluginOptions } from './options'
export { createMorphPlugin, type MorphPluginOptions } from './morph'

const ACTIVE_CLASS = 'editor-decode-active'
// Input skips the reveal to its end. Scrolling does not: the overlay scrolls with the text.
const INPUT_EVENTS = ['keydown', 'pointerdown'] as const
// A reveal draws at most this many pieces; a denser viewport opens without one.
const MAX_PIECES = 4000

/**
 * File-open "writes itself" animation. Including this plugin turns the effect on;
 * removing it turns it off. There is no command, setting, or UI — presence is the switch.
 */
export function createDecodePlugin(options: DecodePluginOptions = {}): EditorPlugin {
  const resolved = resolveDecodeOptions(options)
  return {
    name: 'editor.decode',
    activate: (context) =>
      context.registerViewContribution({
        createContribution: (viewContext) => new DecodeViewContribution(viewContext, resolved),
      }),
  }
}

class DecodeViewContribution implements EditorViewContribution {
  public readonly inputs = ['content', 'tokens', 'viewport', 'layout'] as const
  private animatedDocumentId: string | null = null
  private run: RevealRun | null = null
  private runFrame: ReturnType<typeof buildFrame> = null
  private runSnapshot: EditorViewSnapshot | null = null
  private measurer: TextMeasurer | null = null
  private readonly cover: RowCover
  private readonly options: ResolvedDecodeOptions

  public constructor(
    private readonly context: EditorViewContributionContext,
    options: ResolvedDecodeOptions,
  ) {
    this.cover = new RowCover(context)
    this.options = scaleTimings(options)
  }

  public update(snapshot: EditorViewSnapshot, kind: EditorViewContributionUpdateKind): void {
    if (kind === 'document') {
      this.handleDocumentOpen(snapshot)
      return
    }
    const started = this.runSnapshot
    if (!this.run || !started) return
    // New text or new metrics: the overlay no longer matches the rows under it.
    if (snapshot.textVersion !== started.textVersion || frameMoved(started, snapshot)) {
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
  }

  private handleDocumentOpen(snapshot: EditorViewSnapshot): void {
    const documentId = snapshot.documentId
    if (documentId !== null && documentId === this.animatedDocumentId) return
    // Any other document, empty or not, supersedes an in-flight reveal.
    this.finish()
    if (!documentId || snapshot.textSnapshot.length === 0) return
    if (reducedMotion(this.context)) return
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
      action: 'decode.reveal',
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

  private finish(): void {
    this.removeInputListeners()
    this.context.scrollElement.classList.remove(ACTIVE_CLASS)
    this.cover.showAll()
    this.run?.cancel()
    this.run = null
    this.runFrame = null
    this.runSnapshot = null
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
function scaleTimings(options: ResolvedDecodeOptions): ResolvedDecodeOptions {
  return {
    ...options,
    perCharMs: options.perCharMs / options.speed,
    perTokenMs: options.perTokenMs / options.speed,
    maxDurationMs: options.maxDurationMs / options.speed,
    staggerMs: options.staggerMs / options.speed,
  }
}

function reducedMotion(context: EditorViewContributionContext): boolean {
  const view = context.scrollElement.ownerDocument.defaultView
  return view?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
