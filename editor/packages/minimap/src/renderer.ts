import type { TextEdit } from '@singapore-editor/core/document'
import { createError } from '@singapore-editor/core/logging/evlog'
import { parseCssColor, relativeLuminance, rgbaToCss, transparent } from './color'
import {
  computeFrameLayout,
  computeRenderLayout,
  type MinimapFrameLayout,
  MINIMAP_GUTTER_WIDTH,
  MINIMAP_RIGHT_GUTTER_WIDTH,
  yForLineNumber,
} from './layout'
import { MinimapCharRendererFactory } from './minimapCharRendererFactory'
import { RasterBuffer } from './raster'
import { findSectionHeaderDecorations, findSectionHeaderDecorationsInRange } from './sectionHeaders'
import type {
  EditorMinimapDecoration,
  MinimapBaseStyles,
  MinimapDocumentEditPayload,
  MinimapDocumentPayload,
  MinimapDocumentSummaryPatch,
  MinimapDocumentSummaryPayload,
  MinimapMetrics,
  MinimapRenderLayout,
  MinimapSelection,
  MinimapToken,
  MinimapTokenPatch,
  MinimapViewport,
  ResolvedMinimapOptions,
  RGBA8,
} from './types'
import { RenderMinimap } from './types'

type RendererState = {
  readonly mainCanvas: OffscreenCanvas
  readonly decorationsCanvas: OffscreenCanvas
  readonly mainContext: OffscreenCanvasRenderingContext2D
  readonly decorationsContext: OffscreenCanvasRenderingContext2D
  options: ResolvedMinimapOptions
  styles: MinimapBaseStyles
  document: MinimapDocumentPayload
  externalDecorations: readonly EditorMinimapDecoration[]
  metrics: MinimapMetrics
  viewport: MinimapViewport
  layout: MinimapRenderLayout | null
  previousFrame: MinimapFrameLayout | null
  raster: RasterBuffer | null
  tokenIndex: TokenIndex | null
  surface: RasterSurface | null
  linesDirty: boolean
  decorationsDirty: boolean
}

const EMPTY_DOCUMENT: MinimapDocumentPayload = {
  textLength: 0,
  lineStarts: [0],
  lines: [{ text: '', length: 0 }],
  tokens: [],
  selections: [],
  decorations: [],
  externalDecorations: [],
}

export class MinimapWorkerRenderer {
  private state: RendererState | null = null

  public init(options: {
    readonly mainCanvas: OffscreenCanvas
    readonly decorationsCanvas: OffscreenCanvas
    readonly options: ResolvedMinimapOptions
    readonly styles: MinimapBaseStyles
  }): void {
    const mainContext = options.mainCanvas.getContext('2d')
    const decorationsContext = options.decorationsCanvas.getContext('2d')
    if (!mainContext || !decorationsContext)
      throw new Error('Unable to create minimap canvas context')

    this.state = {
      mainCanvas: options.mainCanvas,
      decorationsCanvas: options.decorationsCanvas,
      mainContext,
      decorationsContext,
      options: options.options,
      styles: options.styles,
      document: EMPTY_DOCUMENT,
      externalDecorations: [],
      metrics: defaultMetrics(),
      viewport: defaultViewport(),
      layout: null,
      previousFrame: null,
      raster: null,
      tokenIndex: null,
      surface: null,
      linesDirty: true,
      decorationsDirty: true,
    }
  }

  public setDocument(document: MinimapDocumentPayload): void {
    if (!this.state) return
    const externalDecorations =
      document.externalDecorations ?? externalDecorationsFrom(document.decorations)
    const sectionHeaders = findSectionHeaderDecorations(documentLines(document), this.state.options)
    this.state.externalDecorations = externalDecorations
    this.state.document = {
      ...document,
      decorations: sectionHeaders.concat(externalDecorations),
      externalDecorations,
    }
    this.state.previousFrame = null
    this.state.linesDirty = true
    this.state.decorationsDirty = true
  }

  public applyEdit(edit: TextEdit, document: MinimapDocumentEditPayload): void {
    this.applyEdits([edit], document)
  }

  public applyEdits(edits: readonly TextEdit[], document: MinimapDocumentEditPayload): void {
    if (!this.state) return
    if (edits.length === 0) {
      this.setSelections(document.selections)
      return
    }

    const previous = this.state.document
    const next = applyTextEditsToMinimapDocument(previous, edits, document.summaryPatch)
    this.setEditedDocument(previous, next, edits, document.selections)
  }

  public setExternalDecorations(decorations: readonly EditorMinimapDecoration[]): void {
    if (!this.state) return

    this.state.externalDecorations = decorations
    this.state.document = {
      ...this.state.document,
      externalDecorations: decorations,
      decorations: sectionHeaderDecorationsFrom(this.state.document.decorations).concat(
        decorations,
      ),
    }
    this.state.decorationsDirty = true
  }

  private setEditedDocument(
    previous: SectionHeaderDocument,
    document: MinimapDocumentSummaryPayload & Pick<MinimapDocumentPayload, 'tokens'>,
    edits: readonly TextEdit[],
    selections: readonly MinimapSelection[],
  ): void {
    const state = this.requireState()
    const decorations = updateSectionHeaderDecorations(
      previous,
      document,
      edits,
      state.options,
    ).concat(state.externalDecorations)
    state.document = {
      textLength: document.textLength,
      lineStarts: document.lineStarts,
      lines: document.lines,
      tokens: document.tokens,
      selections,
      decorations,
      externalDecorations: state.externalDecorations,
    }
    state.linesDirty = true
    state.decorationsDirty = true
  }

  public setBaseStyles(styles: MinimapBaseStyles): void {
    if (!this.state) return
    this.state.styles = styles
    this.state.raster = null
    this.state.linesDirty = true
    this.state.decorationsDirty = true
  }

  public setTokens(tokens: readonly MinimapToken[]): void {
    if (!this.state) return
    this.state.document = { ...this.state.document, tokens }
    this.state.linesDirty = true
  }

  public updateTokenRange(patch: MinimapTokenPatch): void {
    if (!this.state) return

    const tokens = replaceTokenRange(this.state.document.tokens, patch)
    this.state.document = { ...this.state.document, tokens }
    this.state.linesDirty = true
  }

  public setSelections(selections: readonly MinimapSelection[]): void {
    if (!this.state) return
    this.state.document = { ...this.state.document, selections }
    this.state.decorationsDirty = true
  }

  public setDecorations(decorations: readonly EditorMinimapDecoration[]): void {
    if (!this.state) return
    this.state.externalDecorations = externalDecorationsFrom(decorations)
    this.state.document = { ...this.state.document, decorations }
    this.state.decorationsDirty = true
  }

  public updateLayout(
    metrics: MinimapMetrics,
    viewport: MinimapViewport,
  ): MinimapRenderLayout | null {
    if (!this.state) return null
    this.state.metrics = metrics
    this.state.viewport = viewport
    const nextLayout = this.createRenderLayout()
    const layoutChanged = !this.state.layout || !renderLayoutsEqual(this.state.layout, nextLayout)
    this.state.layout = nextLayout
    if (layoutChanged) {
      this.state.linesDirty = true
      this.state.decorationsDirty = true
      this.state.previousFrame = null
    }
    this.resizeCanvases(this.state.layout)
    return this.state.layout
  }

  public updateViewport(viewport: MinimapViewport): MinimapRenderLayout | null {
    if (!this.state) return null
    const previous = this.state.layout
    const next = this.updateLayout(this.state.metrics, viewport)
    if (!next || (previous && renderLayoutsEqual(previous, next))) return null
    return next
  }

  public render(): RenderResult | null {
    if (!this.state) return null

    const layout = this.state.layout ?? this.createRenderLayout()
    this.state.layout = layout
    this.resizeCanvases(layout)
    if (layout.renderMinimap === RenderMinimap.None) return emptyRenderResult()

    const frame = computeFrameLayout({
      renderLayout: layout,
      metrics: this.state.metrics,
      viewport: this.state.viewport,
      lineCount: this.minimapLineCount(layout),
      realLineCount: this.state.document.lineStarts.length,
      previous: this.state.previousFrame,
    })
    const frameChanged =
      !this.state.previousFrame || !framesPaintSameWindow(this.state.previousFrame, frame)

    const surface = this.surfaceForLayout(layout)
    if (this.state.linesDirty || frameChanged) this.renderLines(layout, frame, surface.mainContext)
    if (this.state.decorationsDirty || frameChanged) {
      this.renderDecorations(layout, frame, surface.decorationsContext)
    }
    this.presentSurface(layout, frame, surface)
    this.state.previousFrame = frame
    this.state.linesDirty = false
    this.state.decorationsDirty = false
    return {
      sliderNeeded: frame.sliderNeeded,
      sliderTop: frame.sliderTop,
      sliderHeight: frame.sliderHeight,
      shadowVisible:
        this.state.viewport.scrollLeft + this.state.viewport.clientWidth <
        this.state.viewport.scrollWidth,
    }
  }

  public dispose(): void {
    this.state = null
  }

  private createRenderLayout(): MinimapRenderLayout {
    const state = this.requireState()
    return computeRenderLayout({
      minimap: state.options,
      metrics: state.metrics,
      viewport: state.viewport,
      lineCount: state.document.lineStarts.length,
    })
  }

  private renderLines(
    layout: MinimapRenderLayout,
    frame: FrameLike,
    context: OffscreenCanvasRenderingContext2D,
  ): void {
    const state = this.requireState()
    const raster = this.rasterForLayout(layout, context)
    const previous = state.linesDirty ? null : state.previousFrame
    const reusedStart = Math.max(frame.startLineNumber, previous?.startLineNumber ?? Infinity)
    const reusedEnd = Math.min(frame.endLineNumber, previous?.endLineNumber ?? -Infinity)

    if (previous && reusedStart <= reusedEnd) {
      const sourceY = yForLineNumber(previous, reusedStart, layout.lineHeight)
      const destinationY = yForLineNumber(frame, reusedStart, layout.lineHeight)
      const reusedHeight = (reusedEnd - reusedStart + 1) * layout.lineHeight
      raster.copyRows(sourceY, destinationY, reusedHeight)
      raster.clearRows(0, destinationY)
      raster.clearRows(destinationY + reusedHeight, raster.imageData.height)
      this.renderLineRange(layout, frame, raster.imageData, frame.startLineNumber, reusedStart - 1)
      this.renderLineRange(layout, frame, raster.imageData, reusedEnd + 1, frame.endLineNumber)
    } else {
      raster.clearRows(0, raster.imageData.height)
      this.renderLineRange(
        layout,
        frame,
        raster.imageData,
        frame.startLineNumber,
        frame.endLineNumber,
      )
    }

    context.putImageData(raster.imageData, 0, 0)
  }

  private rasterForLayout(
    layout: MinimapRenderLayout,
    context: OffscreenCanvasRenderingContext2D,
  ): RasterBuffer {
    const state = this.requireState()
    const width = Math.max(1, layout.canvasInnerWidth)
    const height = rasterHeight(layout)
    if (state.raster?.imageData.width === width && state.raster.imageData.height === height) {
      return state.raster
    }

    state.raster = new RasterBuffer(context, width, height, state.styles.minimapBackground)
    return state.raster
  }

  private renderLineRange(
    layout: MinimapRenderLayout,
    frame: FrameLike,
    imageData: ImageData,
    startLineNumber: number,
    endLineNumber: number,
  ): void {
    if (startLineNumber > endLineNumber) return

    const state = this.requireState()
    const charRenderer = MinimapCharRendererFactory.create(layout.scale, state.styles.fontFamily)
    const useLighterFont = relativeLuminance(state.styles.background) >= 0.5
    const renderBackground = state.styles.background
    let tokenCursor = this.tokenCursorForOffset(
      this.lineStartOffset(this.documentLineForRasterLine(layout, startLineNumber)),
    )

    for (let line = startLineNumber; line <= endLineNumber; line += 1) {
      const documentLine = this.documentLineForRasterLine(layout, line)
      const text = this.lineText(documentLine)
      const lineStart = this.lineStartOffset(documentLine)
      const lineEnd = lineStart + text.length
      const lineTokens = tokensForLineFromCursor(
        state.document.tokens,
        lineStart,
        lineEnd,
        tokenCursor,
      )
      tokenCursor = lineTokens.cursor
      this.renderLine({
        imageData,
        layout,
        frame,
        line,
        text,
        lineStart,
        tokens: state.document.tokens,
        tokenEnd: lineTokens.end,
        tokenStart: lineTokens.start,
        charRenderer,
        useLighterFont,
        renderBackground,
        renderBackgroundAlpha: state.styles.minimapBackground.a,
      })
    }
  }

  private tokenCursorForOffset(offset: number): number {
    const state = this.requireState()
    const tokens = state.document.tokens
    if (state.tokenIndex?.tokens !== tokens) {
      state.tokenIndex = { tokens, maxEnds: tokenMaxEnds(tokens) }
    }
    return firstTokenEndingAfter(state.tokenIndex.maxEnds, offset)
  }

  private renderLine(options: RenderLineOptions): void {
    const state = this.requireState()
    const y = yForLineNumber(options.frame, options.line, options.layout.lineHeight)
    const maxDx = options.layout.canvasInnerWidth - options.layout.charWidth
    let dx = MINIMAP_GUTTER_WIDTH

    visitTokenSegments(
      options.text,
      options.lineStart,
      options.tokens,
      options.tokenStart,
      options.tokenEnd,
      state.styles.foreground,
      (text, color) => {
        if (dx > maxDx) return false
        dx = renderSegment({ ...options, text, color, dx, y, maxDx })
        return dx <= maxDx
      },
    )
  }

  private renderDecorations(
    layout: MinimapRenderLayout,
    frame: FrameLike,
    context: OffscreenCanvasRenderingContext2D,
  ): void {
    context.clearRect(0, 0, layout.canvasInnerWidth, rasterHeight(layout))
    const lineCount = this.requireState().document.lineStarts.length
    const decorationLayout = layout.isSampling
      ? { ...layout, lineHeight: layout.canvasInnerHeight / Math.max(1, lineCount) }
      : layout
    const decorationFrame = layout.isSampling ? { ...frame, endLineNumber: lineCount } : frame
    this.renderSelectionHighlights(decorationLayout, decorationFrame, context)
    this.renderMinimapDecorations(decorationLayout, decorationFrame, context)
    this.renderSectionHeaders(decorationLayout, decorationFrame, context)
  }

  private renderSelectionHighlights(
    layout: MinimapRenderLayout,
    frame: FrameLike,
    context: OffscreenCanvasRenderingContext2D,
  ): void {
    const state = this.requireState()
    const color = transparent(state.styles.selection, 0.5)
    context.fillStyle = rgbaToCss(color)

    for (const selection of state.document.selections) {
      const range = this.offsetRangeToLineRange(selection.startOffset, selection.endOffset)
      fillLineRange(context, layout, frame, range.start, range.end)
    }
  }

  private renderMinimapDecorations(
    layout: MinimapRenderLayout,
    frame: FrameLike,
    context: OffscreenCanvasRenderingContext2D,
  ): void {
    const state = this.requireState()
    const decorations = state.document.decorations
      .filter((decoration) => !decoration.sectionHeaderStyle)
      .toSorted((left, right) => (left.zIndex ?? 0) - (right.zIndex ?? 0))

    for (const decoration of decorations) {
      const color = parseCssColor(decoration.color, state.styles.selection)
      context.fillStyle = rgbaToCss(transparent(color, 0.5))
      fillDecorationRange(context, layout, frame, decoration)
    }
  }

  private renderSectionHeaders(
    layout: MinimapRenderLayout,
    frame: FrameLike,
    context: OffscreenCanvasRenderingContext2D,
  ): void {
    const state = this.requireState()
    const fontSize = state.options.sectionHeaderFontSize * state.metrics.devicePixelRatio
    context.font = `500 ${fontSize}px ${state.styles.fontFamily}`
    context.fillStyle = rgbaToCss(transparent(state.styles.minimapBackground, 0.7))
    context.strokeStyle = rgbaToCss(state.styles.foreground)
    context.lineWidth = 0.4

    for (const decoration of state.document.decorations) {
      if (!decoration.sectionHeaderStyle) continue
      renderSectionHeader(context, decoration, layout, frame, fontSize, state.styles.foreground)
    }
  }

  private minimapLineCount(layout: MinimapRenderLayout): number {
    const state = this.requireState()
    if (!layout.isSampling) return state.document.lineStarts.length
    return Math.max(1, Math.min(state.document.lineStarts.length, layout.canvasInnerHeight))
  }

  private documentLineForRasterLine(layout: MinimapRenderLayout, line: number): number {
    if (!layout.isSampling) return line
    const count = this.requireState().document.lineStarts.length
    return Math.floor(((line - 1) * count) / this.minimapLineCount(layout)) + 1
  }

  private lineText(lineNumber: number): string {
    const state = this.requireState()
    return state.document.lines[lineNumber - 1]?.text ?? ''
  }

  private lineStartOffset(lineNumber: number): number {
    const state = this.requireState()
    return state.document.lineStarts[lineNumber - 1] ?? state.document.textLength
  }

  private offsetRangeToLineRange(startOffset: number, endOffset: number): LineRange {
    return {
      start: this.lineNumberForOffset(startOffset),
      end: this.lineNumberForOffset(endOffset),
    }
  }

  private lineNumberForOffset(offset: number): number {
    const state = this.requireState()
    let low = 0
    let high = state.document.lineStarts.length - 1
    const clamped = Math.max(0, Math.min(offset, state.document.textLength))

    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const start = state.document.lineStarts[middle] ?? 0
      const next = state.document.lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY
      if (clamped < start) high = middle - 1
      else if (clamped >= next) low = middle + 1
      else return middle + 1
    }

    return state.document.lineStarts.length
  }

  private resizeCanvases(layout: MinimapRenderLayout): void {
    const state = this.requireState()
    resizeCanvas(state.mainCanvas, layout.canvasInnerWidth, layout.canvasInnerHeight)
    resizeCanvas(state.decorationsCanvas, layout.canvasInnerWidth, layout.canvasInnerHeight)
  }

  private surfaceForLayout(layout: MinimapRenderLayout): RasterSurface {
    const state = this.requireState()
    state.surface ??= createRasterSurface()
    resizeCanvas(state.surface.mainCanvas, layout.canvasInnerWidth, rasterHeight(layout))
    resizeCanvas(state.surface.decorationsCanvas, layout.canvasInnerWidth, rasterHeight(layout))
    return state.surface
  }

  private presentSurface(
    layout: MinimapRenderLayout,
    frame: MinimapFrameLayout,
    surface: RasterSurface,
  ): void {
    const state = this.requireState()
    // Fractional pixel blending dims the glyphs while scrolling.
    const offsetY = Math.round(frame.startLineFraction * layout.lineHeight)
    presentRaster(state.mainContext, surface.mainCanvas, state.mainCanvas, offsetY)
    presentRaster(
      state.decorationsContext,
      surface.decorationsCanvas,
      state.decorationsCanvas,
      offsetY,
    )
  }

  private requireState(): RendererState {
    if (!this.state) throw new Error('Minimap renderer is not initialized')
    return this.state
  }
}

type RenderResult = {
  readonly sliderNeeded: boolean
  readonly sliderTop: number
  readonly sliderHeight: number
  readonly shadowVisible: boolean
}

type FrameLike = {
  readonly startLineNumber: number
  readonly endLineNumber: number
  readonly topPaddingLineCount: number
}

type LineRange = {
  readonly start: number
  readonly end: number
}

type RenderLineOptions = {
  readonly imageData: ImageData
  readonly layout: MinimapRenderLayout
  readonly frame: FrameLike
  readonly line: number
  readonly text: string
  readonly lineStart: number
  readonly tokens: readonly MinimapToken[]
  readonly tokenEnd: number
  readonly tokenStart: number
  readonly charRenderer: ReturnType<typeof MinimapCharRendererFactory.create>
  readonly useLighterFont: boolean
  readonly renderBackground: RGBA8
  readonly renderBackgroundAlpha: number
}

type TokenRange = {
  readonly start: number
  readonly end: number
  readonly cursor: number
}

type TokenIndex = {
  readonly tokens: readonly MinimapToken[]
  readonly maxEnds: Float64Array
}

type RasterSurface = {
  readonly mainCanvas: OffscreenCanvas
  readonly decorationsCanvas: OffscreenCanvas
  readonly mainContext: OffscreenCanvasRenderingContext2D
  readonly decorationsContext: OffscreenCanvasRenderingContext2D
}

function createRasterSurface(): RasterSurface {
  const mainCanvas = new OffscreenCanvas(1, 1)
  const decorationsCanvas = new OffscreenCanvas(1, 1)
  const mainContext = mainCanvas.getContext('2d')
  const decorationsContext = decorationsCanvas.getContext('2d')
  if (!mainContext || !decorationsContext) {
    throw createError({
      message: 'Unable to create minimap raster surface',
      code: 'MINIMAP_RASTER_CONTEXT',
      status: 500,
      why: 'The browser did not provide a 2D context for the minimap raster.',
      fix: 'Check OffscreenCanvas 2D support and canvas resource limits.',
    })
  }
  return { mainCanvas, decorationsCanvas, mainContext, decorationsContext }
}

function rasterHeight(layout: MinimapRenderLayout): number {
  return Math.max(
    1,
    (Math.ceil(layout.canvasInnerHeight / layout.lineHeight) + 1) * layout.lineHeight,
  )
}

function presentRaster(
  context: OffscreenCanvasRenderingContext2D,
  source: OffscreenCanvas,
  target: OffscreenCanvas,
  offsetY: number,
): void {
  context.globalCompositeOperation = 'copy'
  context.imageSmoothingEnabled = true
  context.drawImage(
    source,
    0,
    offsetY,
    target.width,
    target.height,
    0,
    0,
    target.width,
    target.height,
  )
}

function renderSegment(
  options: RenderLineOptions & {
    readonly text: string
    readonly color: RGBA8
    readonly maxDx: number
    dx: number
    y: number
  },
): number {
  let dx = options.dx
  for (let index = 0; index < options.text.length; index += 1) {
    if (dx > options.maxDx) return dx
    dx = renderCharacter(options, dx, options.text.charCodeAt(index))
  }
  return dx
}

function renderCharacter(
  options: RenderLineOptions & { readonly color: RGBA8; y: number },
  dx: number,
  code: number,
): number {
  if (code === 9) return dx + 4 * options.layout.charWidth
  if (code === 32) return dx + options.layout.charWidth

  if (options.layout.renderMinimap === RenderMinimap.Blocks) {
    options.charRenderer.blockRenderChar(
      options.imageData,
      dx,
      options.y,
      options.color,
      255,
      options.renderBackground,
      options.renderBackgroundAlpha,
      options.layout.lineHeight === 1,
    )
    return dx + options.layout.charWidth
  }

  options.charRenderer.renderChar(
    options.imageData,
    dx,
    options.y,
    code,
    options.color,
    255,
    options.renderBackground,
    options.renderBackgroundAlpha,
    options.layout.scale,
    options.useLighterFont,
    options.layout.lineHeight === 1,
  )
  return dx + options.layout.charWidth
}

function visitTokenSegments(
  text: string,
  lineStart: number,
  tokens: readonly MinimapToken[],
  tokenStart: number,
  tokenEnd: number,
  fallback: RGBA8,
  visit: (text: string, color: RGBA8) => boolean,
): void {
  let cursor = 0
  for (let index = tokenStart; index < tokenEnd; index += 1) {
    const token = tokens[index]!
    const start = Math.max(0, token.start - lineStart)
    const end = Math.min(text.length, token.end - lineStart)
    if (start > cursor && !visit(text.slice(cursor, start), fallback)) return
    if (end > start && !visit(text.slice(start, end), token.color)) return
    cursor = Math.max(cursor, end)
  }
  if (cursor < text.length) visit(text.slice(cursor), fallback)
}

function tokensForLineFromCursor(
  tokens: readonly MinimapToken[],
  lineStart: number,
  lineEnd: number,
  cursor: number,
): TokenRange {
  let index = cursor
  while (index < tokens.length && tokens[index]!.end <= lineStart) index += 1

  const start = index
  while (index < tokens.length && tokens[index]!.start < lineEnd) index += 1

  return { start, end: index, cursor: start }
}

function tokenMaxEnds(tokens: readonly MinimapToken[]): Float64Array {
  const maxEnds = new Float64Array(tokens.length)
  let maxEnd = 0
  for (let index = 0; index < tokens.length; index += 1) {
    maxEnd = Math.max(maxEnd, tokens[index]!.end)
    maxEnds[index] = maxEnd
  }
  return maxEnds
}

function firstTokenEndingAfter(maxEnds: Float64Array, offset: number): number {
  let low = 0
  let high = maxEnds.length
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (maxEnds[middle]! <= offset) {
      low = middle + 1
      continue
    }
    high = middle
  }
  return low
}

function fillLineRange(
  context: OffscreenCanvasRenderingContext2D,
  layout: MinimapRenderLayout,
  frame: FrameLike,
  startLineNumber: number,
  endLineNumber: number,
): void {
  const start = Math.max(frame.startLineNumber, startLineNumber)
  const end = Math.min(frame.endLineNumber, endLineNumber)
  if (start > end) return

  const y = yForLineNumber(frame, start, layout.lineHeight)
  const height = Math.max(
    layout.lineHeight,
    yForLineNumber(frame, end, layout.lineHeight) - y + layout.lineHeight,
  )
  context.fillRect(MINIMAP_GUTTER_WIDTH, y, layout.canvasInnerWidth, height)
}

function fillDecorationRange(
  context: OffscreenCanvasRenderingContext2D,
  layout: MinimapRenderLayout,
  frame: FrameLike,
  decoration: EditorMinimapDecoration,
): void {
  if (decoration.position === 'gutter') {
    fillGutterLineRange(
      context,
      layout,
      frame,
      decoration.startLineNumber,
      decoration.endLineNumber,
    )
    return
  }

  fillLineRange(context, layout, frame, decoration.startLineNumber, decoration.endLineNumber)
}

function fillGutterLineRange(
  context: OffscreenCanvasRenderingContext2D,
  layout: MinimapRenderLayout,
  frame: FrameLike,
  startLineNumber: number,
  endLineNumber: number,
): void {
  const range = visibleLineRange(frame, startLineNumber, endLineNumber)
  if (!range) return

  const y = yForLineNumber(frame, range.start, layout.lineHeight)
  const height = lineRangeHeight(layout, frame, range.end, y)
  const width = minimapRightGutterWidth(layout)
  context.fillRect(layout.canvasInnerWidth - width, y, width, height)
}

function visibleLineRange(
  frame: FrameLike,
  startLineNumber: number,
  endLineNumber: number,
): LineRange | null {
  const start = Math.max(frame.startLineNumber, startLineNumber)
  const end = Math.min(frame.endLineNumber, endLineNumber)
  if (start > end) return null
  return { start, end }
}

function lineRangeHeight(
  layout: MinimapRenderLayout,
  frame: FrameLike,
  endLineNumber: number,
  y: number,
): number {
  return Math.max(
    layout.lineHeight,
    yForLineNumber(frame, endLineNumber, layout.lineHeight) - y + layout.lineHeight,
  )
}

function minimapRightGutterWidth(layout: MinimapRenderLayout): number {
  const horizontalScale = layout.canvasInnerWidth / Math.max(1, layout.canvasOuterWidth)
  return Math.max(2, Math.ceil(MINIMAP_RIGHT_GUTTER_WIDTH * horizontalScale))
}

function renderSectionHeader(
  context: OffscreenCanvasRenderingContext2D,
  decoration: EditorMinimapDecoration,
  layout: MinimapRenderLayout,
  frame: FrameLike,
  fontSize: number,
  color: RGBA8,
): void {
  if (
    decoration.startLineNumber < frame.startLineNumber ||
    decoration.startLineNumber > frame.endLineNumber
  ) {
    return
  }

  const y = yForLineNumber(frame, decoration.startLineNumber, layout.lineHeight) + fontSize
  context.fillRect(0, y - fontSize, layout.canvasInnerWidth, fontSize * 1.5)
  context.fillStyle = rgbaToCss(color)
  if (decoration.sectionHeaderText) {
    context.fillText(decoration.sectionHeaderText, MINIMAP_GUTTER_WIDTH, y, layout.canvasInnerWidth)
  }
  if (decoration.sectionHeaderStyle === 'underlined') {
    context.beginPath()
    context.moveTo(0, y - fontSize + 2)
    context.lineTo(layout.canvasInnerWidth, y - fontSize + 2)
    context.stroke()
  }
}

function resizeCanvas(canvas: OffscreenCanvas, width: number, height: number): void {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  if (canvas.width !== safeWidth) canvas.width = safeWidth
  if (canvas.height !== safeHeight) canvas.height = safeHeight
}

function renderLayoutsEqual(left: MinimapRenderLayout, right: MinimapRenderLayout): boolean {
  return (
    left.width === right.width &&
    left.height === right.height &&
    left.canvasInnerWidth === right.canvasInnerWidth &&
    left.canvasInnerHeight === right.canvasInnerHeight &&
    left.lineHeight === right.lineHeight &&
    left.charWidth === right.charWidth &&
    left.scale === right.scale &&
    left.isSampling === right.isSampling &&
    left.heightIsEditorHeight === right.heightIsEditorHeight &&
    left.renderMinimap === right.renderMinimap
  )
}

function framesPaintSameWindow(left: MinimapFrameLayout, right: MinimapFrameLayout): boolean {
  return (
    left.startLineNumber === right.startLineNumber &&
    left.endLineNumber === right.endLineNumber &&
    left.topPaddingLineCount === right.topPaddingLineCount
  )
}

function defaultMetrics(): MinimapMetrics {
  return { rowHeight: 20, characterWidth: 8, devicePixelRatio: 1 }
}

function defaultViewport(): MinimapViewport {
  return {
    scrollTop: 0,
    scrollRow: 0,
    scrollLeft: 0,
    scrollHeight: 0,
    scrollWidth: 0,
    clientHeight: 0,
    clientWidth: 0,
    minimapHeight: 0,
    visibleStart: 0,
    reservedWidth: 0,
    visibleEnd: 1,
  }
}

function emptyRenderResult(): RenderResult {
  return { sliderNeeded: false, sliderTop: 0, sliderHeight: 0, shadowVisible: false }
}

function applyTextEditsToMinimapDocument(
  document: Pick<MinimapDocumentPayload, 'lineStarts' | 'lines' | 'textLength' | 'tokens'>,
  edits: readonly TextEdit[],
  summaryPatch: MinimapDocumentSummaryPatch,
): MinimapDocumentSummaryPayload & Pick<MinimapDocumentPayload, 'tokens'> {
  let tokens = document.tokens

  for (const edit of edits) {
    tokens = projectMinimapTokensThroughEdit(tokens, edit, tokenProjectionText(document))
  }

  const summary = applyMinimapDocumentSummaryPatch(document, summaryPatch)
  return { ...summary, tokens }
}

function applyMinimapDocumentSummaryPatch(
  document: Pick<MinimapDocumentPayload, 'lines' | 'lineStarts' | 'textLength'>,
  patch: MinimapDocumentSummaryPatch,
): MinimapDocumentSummaryPayload {
  const startLine = Math.min(Math.max(0, patch.startLine), document.lines.length)
  const deleteCount = Math.min(Math.max(0, patch.deleteCount), document.lines.length - startLine)

  return {
    textLength: patch.textLength,
    lineStarts: patch.lineStarts ?? splicedLineStarts(document, patch, startLine, deleteCount),
    lines: document.lines
      .slice(0, startLine)
      .concat(patch.lines, document.lines.slice(startLine + deleteCount)),
  }
}

// Rebuilds line starts from the patch instead of receiving them over
// postMessage: lines before the patch keep their starts, inserted lines chain
// from the previous line's full length, and lines after the patch shift by
// the document length delta.
function splicedLineStarts(
  document: Pick<MinimapDocumentPayload, 'lines' | 'lineStarts' | 'textLength'>,
  patch: MinimapDocumentSummaryPatch,
  startLine: number,
  deleteCount: number,
): readonly number[] {
  const previous = document.lineStarts
  const next: number[] = previous.slice(0, startLine) as number[]
  let cursor = lineStartAt(previous, document.lines, startLine)
  for (const line of patch.lines) {
    next.push(cursor)
    cursor += line.length + 1
  }

  const delta = patch.textLength - document.textLength
  for (let index = startLine + deleteCount; index < previous.length; index += 1) {
    next.push(previous[index]! + delta)
  }

  return next
}

function lineStartAt(
  lineStarts: readonly number[],
  lines: MinimapDocumentSummaryPayload['lines'],
  line: number,
): number {
  const existing = lineStarts[line]
  if (existing !== undefined) return existing
  if (line === 0) return 0

  const previousStart = lineStarts[line - 1] ?? 0
  const previousLength = lines[line - 1]?.length ?? 0
  return previousStart + previousLength + 1
}

function lineIndexForOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0
  let high = lineStarts.length - 1
  const clamped = Math.max(0, offset)

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const start = lineStarts[middle] ?? 0
    const next = lineStarts[middle + 1] ?? Number.POSITIVE_INFINITY
    if (clamped < start) {
      high = middle - 1
      continue
    }
    if (clamped >= next) {
      low = middle + 1
      continue
    }
    return middle
  }

  return Math.max(0, lineStarts.length - 1)
}

const SECTION_HEADER_EDIT_CONTEXT_LINES = 10

type SectionHeaderDocument = Pick<MinimapDocumentPayload, 'decorations' | 'lineStarts' | 'lines'>
type SectionHeaderTextDocument = Pick<MinimapDocumentPayload, 'lineStarts' | 'lines'>
type LineNumberRange = {
  readonly start: number
  readonly end: number
}

function updateSectionHeaderDecorations(
  previous: SectionHeaderDocument,
  next: SectionHeaderTextDocument,
  edits: readonly TextEdit[],
  options: ResolvedMinimapOptions,
): readonly EditorMinimapDecoration[] {
  if (!options.showMarkSectionHeaders) return []
  if (edits.length === 0) return sectionHeaderDecorationsFrom(previous.decorations)

  const oldRange = affectedOldLineRange(previous.lineStarts, edits)
  const nextRange = affectedNextLineRange(next.lineStarts, edits)
  const lineDelta = next.lineStarts.length - previous.lineStarts.length
  const shifted = shiftedSectionHeaders(previous.decorations, oldRange, nextRange, lineDelta)
  const rescanned = rescanSectionHeaders(next, nextRange, options)
  return shifted.concat(rescanned).sort(compareDecorationsByLine)
}

function affectedOldLineRange(
  lineStarts: readonly number[],
  edits: readonly TextEdit[],
): LineNumberRange {
  let start = Number.POSITIVE_INFINITY
  let end = 1

  for (const edit of edits) {
    start = Math.min(start, lineIndexForOffset(lineStarts, edit.from) + 1)
    end = Math.max(end, lineIndexForOffset(lineStarts, edit.to) + 1)
  }

  return expandLineRange({ start, end }, lineStarts.length)
}

function affectedNextLineRange(
  lineStarts: readonly number[],
  edits: readonly TextEdit[],
): LineNumberRange {
  let start = Number.POSITIVE_INFINITY
  let end = 1

  for (const edit of edits) {
    start = Math.min(start, lineIndexForOffset(lineStarts, edit.from) + 1)
    end = Math.max(end, lineIndexForOffset(lineStarts, edit.from + edit.text.length) + 1)
  }

  return expandLineRange({ start, end }, lineStarts.length)
}

function expandLineRange(range: LineNumberRange, lineCount: number): LineNumberRange {
  return {
    start: Math.max(1, range.start - SECTION_HEADER_EDIT_CONTEXT_LINES),
    end: Math.min(lineCount, range.end + SECTION_HEADER_EDIT_CONTEXT_LINES),
  }
}

function shiftedSectionHeaders(
  decorations: readonly EditorMinimapDecoration[],
  oldRange: LineNumberRange,
  nextRange: LineNumberRange,
  lineDelta: number,
): readonly EditorMinimapDecoration[] {
  const headers = sectionHeaderDecorationsFrom(decorations)
  return headers.flatMap((decoration) =>
    shiftSectionHeaderDecoration(decoration, oldRange, nextRange, lineDelta),
  )
}

function shiftSectionHeaderDecoration(
  decoration: EditorMinimapDecoration,
  oldRange: LineNumberRange,
  nextRange: LineNumberRange,
  lineDelta: number,
): readonly EditorMinimapDecoration[] {
  if (lineRangesIntersect(decoration, oldRange)) return []

  if (decoration.startLineNumber <= oldRange.end) {
    return lineRangesIntersect(decoration, nextRange) ? [] : [decoration]
  }

  const shifted = shiftDecoration(decoration, lineDelta)
  return lineRangesIntersect(shifted, nextRange) ? [] : [shifted]
}

function shiftDecoration(
  decoration: EditorMinimapDecoration,
  lineDelta: number,
): EditorMinimapDecoration {
  if (lineDelta === 0) return decoration

  return {
    ...decoration,
    startLineNumber: decoration.startLineNumber + lineDelta,
    endLineNumber: decoration.endLineNumber + lineDelta,
  }
}

function rescanSectionHeaders(
  document: SectionHeaderTextDocument,
  range: LineNumberRange,
  options: ResolvedMinimapOptions,
): readonly EditorMinimapDecoration[] {
  const lines = linesForRange(document.lines, range)
  return findSectionHeaderDecorationsInRange(lines, range.start, options)
}

function linesForRange(
  summaries: readonly { readonly text: string }[],
  range: LineNumberRange,
): readonly string[] {
  const lines: string[] = []
  for (let lineNumber = range.start; lineNumber <= range.end; lineNumber += 1) {
    lines.push(summaries[lineNumber - 1]?.text ?? '')
  }

  return lines
}

function lineRangesIntersect(decoration: EditorMinimapDecoration, range: LineNumberRange): boolean {
  return decoration.startLineNumber <= range.end && decoration.endLineNumber >= range.start
}

function compareDecorationsByLine(
  left: EditorMinimapDecoration,
  right: EditorMinimapDecoration,
): number {
  return left.startLineNumber - right.startLineNumber || left.endLineNumber - right.endLineNumber
}

function externalDecorationsFrom(
  decorations: readonly EditorMinimapDecoration[],
): readonly EditorMinimapDecoration[] {
  return decorations.filter((decoration) => !decoration.sectionHeaderStyle)
}

function sectionHeaderDecorationsFrom(
  decorations: readonly EditorMinimapDecoration[],
): readonly EditorMinimapDecoration[] {
  return decorations.filter((decoration) => decoration.sectionHeaderStyle)
}

function replaceTokenRange(
  tokens: readonly MinimapToken[],
  patch: MinimapTokenPatch,
): readonly MinimapToken[] {
  const start = clampTokenIndex(patch.start, tokens.length)
  const deleteEnd = clampTokenIndex(start + patch.deleteCount, tokens.length)
  return tokens.slice(0, start).concat(patch.tokens, tokens.slice(deleteEnd))
}

function clampTokenIndex(index: number, length: number): number {
  return Math.min(length, Math.max(0, index))
}

export function projectMinimapTokensThroughEdit(
  tokens: readonly MinimapToken[],
  edit: TextEdit,
  previousText: MinimapTokenProjectionText,
): readonly MinimapToken[] {
  const delta = edit.text.length - (edit.to - edit.from)
  const projected: MinimapToken[] = []
  for (const token of tokens) {
    const next = projectMinimapTokenThroughEdit(token, edit, previousText, delta)
    if (isRenderableMinimapToken(next)) projected.push(next)
  }
  return projected
}

function projectMinimapTokenThroughEdit(
  token: MinimapToken,
  edit: TextEdit,
  previousText: MinimapTokenProjectionText,
  delta: number,
): MinimapToken | null {
  if (edit.from === edit.to) return projectMinimapTokenThroughInsertion(token, edit, previousText)
  if (token.end <= edit.from) return token
  if (token.start >= edit.to) return shiftMinimapToken(token, delta)
  if (!canResizeMinimapTokenAcrossEdit(token, edit)) return null

  return { ...token, end: token.end + delta }
}

function projectMinimapTokenThroughInsertion(
  token: MinimapToken,
  edit: TextEdit,
  previousText: MinimapTokenProjectionText,
): MinimapToken {
  if (shouldExpandMinimapTokenForInsertion(token, edit, previousText)) {
    return { ...token, end: token.end + edit.text.length }
  }
  if (token.start >= edit.from) return shiftMinimapToken(token, edit.text.length)

  return token
}

function canResizeMinimapTokenAcrossEdit(token: MinimapToken, edit: TextEdit): boolean {
  if (edit.text.includes('\n')) return false
  return token.start < edit.from && edit.to < token.end
}

function shouldExpandMinimapTokenForInsertion(
  token: MinimapToken,
  edit: TextEdit,
  previousText: MinimapTokenProjectionText,
): boolean {
  if (edit.text.length === 0) return false
  if (edit.text.includes('\n')) return false
  if (token.start < edit.from && edit.from < token.end) return true
  if (!isWordLikeText(edit.text)) return false
  if (token.end === edit.from) return textHasWordBeforeOffset(previousText, edit.from)
  if (token.start === edit.from) {
    return (
      !textHasWordBeforeOffset(previousText, edit.from) &&
      textHasWordCodePointAt(previousText, edit.from)
    )
  }

  return false
}

function shiftMinimapToken(token: MinimapToken, delta: number): MinimapToken {
  return {
    ...token,
    start: token.start + delta,
    end: token.end + delta,
  }
}

function isRenderableMinimapToken(token: MinimapToken | null): token is MinimapToken {
  if (!token) return false
  return token.end > token.start
}

function isWordLikeText(text: string): boolean {
  return /^[\p{L}\p{N}_]+$/u.test(text)
}

type MinimapTokenProjectionText =
  | string
  | {
      isWordBeforeOffset(offset: number): boolean
      isWordCodePointAt(offset: number): boolean
    }

function tokenProjectionText(
  document: Pick<MinimapDocumentPayload, 'lineStarts' | 'lines' | 'textLength'>,
): MinimapTokenProjectionText {
  return {
    isWordBeforeOffset: (offset) => summaryHasWordBeforeOffset(document, offset),
    isWordCodePointAt: (offset) => summaryHasWordCodePointAt(document, offset),
  }
}

function documentLines(document: Pick<MinimapDocumentPayload, 'lines'>): readonly string[] {
  return document.lines.map((line) => line.text)
}

function textHasWordBeforeOffset(text: MinimapTokenProjectionText, offset: number): boolean {
  if (typeof text !== 'string') return text.isWordBeforeOffset(offset)
  return stringHasWordBeforeOffset(text, offset)
}

function textHasWordCodePointAt(text: MinimapTokenProjectionText, offset: number): boolean {
  if (typeof text !== 'string') return text.isWordCodePointAt(offset)
  return stringHasWordCodePointAt(text, offset)
}

function summaryHasWordBeforeOffset(
  document: Pick<MinimapDocumentPayload, 'lineStarts' | 'lines' | 'textLength'>,
  offset: number,
): boolean {
  const location = summaryOffsetLocation(document, offset)
  if (!location) return false

  return stringHasWordBeforeOffset(location.text, location.localOffset)
}

function summaryHasWordCodePointAt(
  document: Pick<MinimapDocumentPayload, 'lineStarts' | 'lines' | 'textLength'>,
  offset: number,
): boolean {
  const location = summaryOffsetLocation(document, offset)
  if (!location) return false

  return stringHasWordCodePointAt(location.text, location.localOffset)
}

function summaryOffsetLocation(
  document: Pick<MinimapDocumentPayload, 'lineStarts' | 'lines' | 'textLength'>,
  offset: number,
): { readonly text: string; readonly localOffset: number } | null {
  const clamped = Math.max(0, Math.min(offset, document.textLength))
  const lineIndex = lineIndexForOffset(document.lineStarts, clamped)
  const lineStart = document.lineStarts[lineIndex] ?? 0
  const text = document.lines[lineIndex]?.text ?? ''
  const localOffset = clamped - lineStart
  if (localOffset < 0 || localOffset > text.length) return null

  return { text, localOffset }
}

function stringHasWordBeforeOffset(text: string, offset: number): boolean {
  const previous = previousCodePointStart(text, offset)
  if (previous === null) return false
  return stringHasWordCodePointAt(text, previous)
}

function stringHasWordCodePointAt(text: string, offset: number): boolean {
  const codePoint = text.codePointAt(offset)
  if (codePoint === undefined) return false
  return /^[\p{L}\p{N}_]$/u.test(String.fromCodePoint(codePoint))
}

function previousCodePointStart(text: string, offset: number): number | null {
  if (offset <= 0) return null

  const previous = offset - 1
  const codeUnit = text.charCodeAt(previous)
  const beforePrevious = previous - 1
  const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff
  if (!isLowSurrogate || beforePrevious < 0) return previous

  const previousCodeUnit = text.charCodeAt(beforePrevious)
  const isHighSurrogate = previousCodeUnit >= 0xd800 && previousCodeUnit <= 0xdbff
  return isHighSurrogate ? beforePrevious : previous
}
