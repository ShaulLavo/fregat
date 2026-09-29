import type { EditorViewSnapshot, EditorViewportSnapshot } from '@singapore-editor/core/extensions'
import { Constants } from './minimapCharSheet'
import type {
  MinimapMetrics,
  MinimapRenderLayout,
  MinimapViewport,
  ResolvedMinimapOptions,
} from './types'
import { RenderMinimap } from './types'

export const MINIMAP_GUTTER_WIDTH = 2
export const MINIMAP_RIGHT_GUTTER_WIDTH = 8

export type MinimapFrameLayout = {
  readonly scrollTop: number
  readonly scrollHeight: number
  readonly sliderNeeded: boolean
  readonly sliderLineHeight: number
  readonly documentLineHeight: number
  readonly documentStart: number
  readonly sliderTop: number
  readonly sliderHeight: number
  readonly topPaddingLineCount: number
  readonly startLineNumber: number
  readonly startLineFraction: number
  readonly endLineNumber: number
}

export function computeRenderLayout(options: {
  readonly minimap: ResolvedMinimapOptions
  readonly metrics: MinimapMetrics
  readonly viewport: MinimapViewport
  readonly lineCount: number
}): MinimapRenderLayout {
  const pixelRatio = Math.max(1, options.metrics.devicePixelRatio)
  const height = Math.max(0, options.viewport.minimapHeight)
  const baseCharHeight = options.minimap.renderCharacters
    ? Constants.BASE_CHAR_HEIGHT
    : Constants.BASE_CHAR_HEIGHT + 1
  const configuredScale =
    pixelRatio >= 2 ? Math.round(options.minimap.scale * 2) : options.minimap.scale
  const baseCanvasInnerHeight = Math.floor(pixelRatio * height)
  const fitted = computeFittedScale({
    baseCharHeight,
    canvasInnerHeight: baseCanvasInnerHeight,
    configuredScale,
    height,
    lineCount: options.lineCount,
    // A collapsed span can exceed the proportional raster's document coverage.
    minimap:
      (options.viewport.visibleEnd - options.viewport.visibleStart) *
        baseCharHeight *
        configuredScale >
      baseCanvasInnerHeight
        ? { ...options.minimap, size: 'fill' }
        : options.minimap,
    pixelRatio,
    rowHeight: options.metrics.rowHeight,
  })
  const layoutCharWidth = fitted.scale / pixelRatio / fitted.widthMultiplier
  const width = computeMinimapWidth({
    charWidth: layoutCharWidth,
    maxColumn: options.minimap.maxColumn,
    viewportWidth: options.viewport.clientWidth + Math.max(0, options.viewport.reservedWidth),
    characterWidth: options.metrics.characterWidth,
  })
  const baseCanvasInnerWidth = Math.floor(pixelRatio * width)
  const canvasInnerWidth = Math.floor(baseCanvasInnerWidth * fitted.widthMultiplier)
  const canvasInnerHeight = fitted.heightIsEditorHeight
    ? Math.ceil(Math.max(baseCanvasInnerHeight, fitted.documentMinimapHeight))
    : baseCanvasInnerHeight

  return {
    width,
    height,
    canvasInnerWidth,
    canvasInnerHeight,
    canvasOuterWidth: baseCanvasInnerWidth / pixelRatio,
    canvasOuterHeight: baseCanvasInnerHeight / pixelRatio,
    lineHeight: fitted.lineHeight,
    charWidth: Constants.BASE_CHAR_WIDTH * fitted.scale,
    scale: fitted.scale,
    isSampling: fitted.isSampling,
    heightIsEditorHeight: fitted.heightIsEditorHeight,
    renderMinimap: options.minimap.enabled
      ? options.minimap.renderCharacters
        ? RenderMinimap.Text
        : RenderMinimap.Blocks
      : RenderMinimap.None,
  }
}

export function computeFrameLayout(options: {
  readonly renderLayout: MinimapRenderLayout
  readonly metrics: MinimapMetrics
  readonly viewport: MinimapViewport
  readonly lineCount: number
  readonly realLineCount: number
  readonly previous: MinimapFrameLayout | null
}): MinimapFrameLayout {
  const { renderLayout: layout, viewport, realLineCount } = options
  const pixelRatio = layout.canvasInnerHeight / Math.max(1, layout.canvasOuterHeight)
  const documentLineHeight = layout.isSampling
    ? layout.height / Math.max(1, realLineCount)
    : layout.lineHeight / pixelRatio
  const start = Math.min(realLineCount, Math.max(0, viewport.visibleStart))
  const end = Math.min(realLineCount, Math.max(start, viewport.visibleEnd))
  const visibleCount = end - start
  const linesFitting = layout.height / documentLineHeight
  const travel = Math.max(0, realLineCount - linesFitting)
  const progress = start / Math.max(1, realLineCount - visibleCount)
  const documentStart = Math.min(start, travel * progress)
  const rasterStart = layout.isSampling ? 0 : documentStart
  const startLineNumber = Math.floor(rasterStart) + 1
  const startLineFraction = rasterStart - Math.floor(rasterStart)
  return {
    scrollTop: viewport.scrollTop,
    scrollHeight: viewport.scrollHeight,
    sliderNeeded: visibleCount < realLineCount,
    documentLineHeight,
    sliderLineHeight:
      travel > 0
        ? Math.max(0, layout.height - visibleCount * documentLineHeight) /
          Math.max(1, realLineCount - visibleCount)
        : documentLineHeight,
    documentStart,
    sliderTop: (start - documentStart) * documentLineHeight,
    sliderHeight: Math.min(layout.height, visibleCount * documentLineHeight),
    topPaddingLineCount: 0,
    startLineNumber,
    startLineFraction,
    endLineNumber: Math.min(
      options.lineCount,
      startLineNumber +
        Math.ceil(layout.canvasInnerHeight / layout.lineHeight + startLineFraction) -
        1,
    ),
  }
}

/** Zero-based document line at a CSS pixel in the rendered minimap. */
export function documentLineAtY(frame: MinimapFrameLayout, y: number): number {
  return frame.documentStart + y / frame.documentLineHeight
}

/** Inverse of slider placement, including a proportional raster's moving origin. */
export function documentLineForSliderY(frame: MinimapFrameLayout, y: number): number {
  if (frame.sliderLineHeight <= 0) return 0
  return y / frame.sliderLineHeight
}

/** Mounted rows include overscan. Continuations still identify a visible document line. */
export function visibleDocumentLineRange(
  snapshot: Pick<EditorViewSnapshot, 'visibleRows' | 'lineCount'>,
  viewport: EditorViewportSnapshot,
): { readonly start: number; readonly end: number } {
  let start = Infinity
  let end = 0
  const wrapped = new Set(
    snapshot.visibleRows
      .filter((row) => row.source === 'document' && !row.firstWrapSegment)
      .map((row) => row.bufferRow),
  )
  for (const row of snapshot.visibleRows) {
    if (row.source !== 'document') continue
    if (row.top + row.height <= viewport.scrollTop) continue
    if (row.top >= viewport.scrollTop + viewport.clientHeight) continue
    const clippedStart = Math.max(0, (viewport.scrollTop - row.top) / row.height)
    const clippedEnd = Math.min(
      1,
      (viewport.scrollTop + viewport.clientHeight - row.top) / row.height,
    )
    start = Math.min(start, row.bufferRow + (wrapped.has(row.bufferRow) ? 0 : clippedStart))
    end = Math.max(end, row.bufferRow + (wrapped.has(row.bufferRow) ? 1 : clippedEnd))
  }
  if (start !== Infinity) return { start, end }
  const nearest = snapshot.visibleRows.find((row) => row.source === 'document')
  const anchor = Math.min(Math.max(0, snapshot.lineCount - 1), nearest?.bufferRow ?? 0)
  return { start: anchor, end: anchor }
}

export function yForLineNumber(
  frame: Pick<MinimapFrameLayout, 'startLineNumber' | 'topPaddingLineCount'>,
  lineNumber: number,
  minimapLineHeight: number,
): number {
  return (lineNumber - frame.startLineNumber + frame.topPaddingLineCount) * minimapLineHeight
}

function computeFittedScale(options: {
  readonly minimap: ResolvedMinimapOptions
  readonly baseCharHeight: number
  readonly canvasInnerHeight: number
  readonly configuredScale: number
  readonly height: number
  readonly pixelRatio: number
  readonly rowHeight: number
  readonly lineCount: number
}): {
  readonly scale: number
  readonly lineHeight: number
  readonly widthMultiplier: number
  readonly isSampling: boolean
  readonly heightIsEditorHeight: boolean
  readonly documentMinimapHeight: number
} {
  const lineHeight = options.baseCharHeight * options.configuredScale
  if (options.minimap.size === 'proportional') {
    return fittedScale(options.configuredScale, lineHeight, 1, false, false, 0)
  }

  const desiredRatio = options.lineCount / Math.max(1, options.canvasInnerHeight)
  if (desiredRatio > 1) return fittedScale(1, 1, 1, true, true, options.canvasInnerHeight)

  if (options.minimap.size === 'fit') {
    const documentHeight = Math.ceil(options.lineCount * lineHeight)
    if (documentHeight <= options.canvasInnerHeight) {
      return fittedScale(options.configuredScale, lineHeight, 1, false, false, documentHeight)
    }
  }

  const maxScale = options.configuredScale + 1
  const fillLineHeight = Math.min(
    options.rowHeight * options.pixelRatio,
    Math.max(1, Math.floor(1 / desiredRatio)),
  )
  const scale = Math.min(maxScale, Math.max(1, Math.floor(fillLineHeight / options.baseCharHeight)))
  const widthMultiplier =
    scale > options.configuredScale ? Math.min(2, scale / options.configuredScale) : 1
  const typicalViewportLineCount = options.height / Math.max(1, options.rowHeight)
  return fittedScale(
    scale,
    fillLineHeight,
    widthMultiplier,
    false,
    true,
    Math.ceil(Math.max(typicalViewportLineCount, options.lineCount) * fillLineHeight),
  )
}

function fittedScale(
  scale: number,
  lineHeight: number,
  widthMultiplier: number,
  isSampling: boolean,
  heightIsEditorHeight: boolean,
  documentMinimapHeight: number,
) {
  return {
    scale,
    lineHeight,
    widthMultiplier,
    isSampling,
    heightIsEditorHeight,
    documentMinimapHeight,
  }
}

function computeMinimapWidth(options: {
  readonly charWidth: number
  readonly maxColumn: number
  readonly viewportWidth: number
  readonly characterWidth: number
}): number {
  const availableWidth = Math.max(0, options.viewportWidth)
  const minimapMaxWidth = Math.floor(options.maxColumn * options.charWidth)
  const proportionalWidth = Math.floor(
    ((availableWidth - 2) * options.charWidth) / (options.characterWidth + options.charWidth),
  )
  return Math.min(
    minimapMaxWidth,
    Math.max(0, proportionalWidth) + MINIMAP_GUTTER_WIDTH + MINIMAP_RIGHT_GUTTER_WIDTH,
  )
}
