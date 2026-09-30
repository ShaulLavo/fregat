import { createError } from '@singapore-editor/core/logging/evlog'
import { resolveMinimapOptions } from '../src/options'
import { MinimapWorkerRenderer } from '../src/renderer'
import type {
  MinimapBaseStyles,
  MinimapDocumentPayload,
  MinimapMetrics,
  MinimapToken,
  MinimapViewport,
  RGBA8,
} from '../src/types'

type RasterCase = {
  readonly dpr: number
  readonly renderCharacters: boolean
  readonly alpha: number
  readonly scale: number
}

type RenderTarget = {
  readonly renderer: MinimapWorkerRenderer
  readonly main: OffscreenCanvas
  readonly decorations: OffscreenCanvas
}

type RasterPair = {
  readonly actual: RenderTarget
  readonly expected: RenderTarget
  styles: MinimapBaseStyles
  document: MinimapDocumentPayload
  viewport: MinimapViewport
  metrics: MinimapMetrics
}

type PixelOracleResult = { cases: number; frames: number; comparedBytes: number }

export function runRasterPixelOracle(): PixelOracleResult {
  const result = { cases: 0, frames: 0, comparedBytes: 0 }
  for (const options of rasterCases()) {
    runRasterCase(options, result)
    result.cases += 1
  }
  verifyOverlappingTokens(result)
  result.cases += 1
  for (const dpr of [1, 1.25, 2]) {
    verifyPixelSnappedMotion(dpr, result)
    result.cases += 1
  }
  return result
}

function rasterCases(): readonly RasterCase[] {
  const cases: RasterCase[] = []
  for (const dpr of [1, 1.25, 2]) cases.push(...casesForPixelRatio(dpr))
  cases.push({ dpr: 1.25, renderCharacters: true, alpha: 128, scale: 3 })
  cases.push({ dpr: 2, renderCharacters: false, alpha: 0, scale: 3 })
  return cases
}

function casesForPixelRatio(dpr: number): readonly RasterCase[] {
  const cases: RasterCase[] = []
  for (const renderCharacters of [true, false]) {
    for (const alpha of [0, 128, 255]) cases.push({ dpr, renderCharacters, alpha, scale: 1 })
  }
  return cases
}

function runRasterCase(options: RasterCase, result: PixelOracleResult): void {
  const pair = createPair(options)
  const label = JSON.stringify(options)
  try {
    verifyScrolling(pair, label, result)
    verifyMutations(pair, label, result)
    verifyLayoutChanges(pair, label, result)
  } finally {
    pair.actual.renderer.dispose()
    pair.expected.renderer.dispose()
  }
}

function createPair(options: RasterCase): RasterPair {
  const styles = baseStyles(options.alpha)
  const document = documentPayload(Array.from({ length: 300 }, (_, line) => fixtureLine(line)))
  const viewport = viewportForDocument(document)
  const metrics = { rowHeight: 20, characterWidth: 8, devicePixelRatio: options.dpr }
  const actual = createTarget(options, styles)
  const expected = createTarget(options, styles)
  const pair = { actual, expected, styles, document, viewport, metrics }
  for (const target of [actual, expected]) {
    target.renderer.setDocument(document)
    target.renderer.updateLayout(metrics, viewport)
  }
  return pair
}

function createTarget(options: RasterCase, styles: MinimapBaseStyles): RenderTarget {
  const renderer = new MinimapWorkerRenderer()
  const main = new OffscreenCanvas(1, 1)
  const decorations = new OffscreenCanvas(1, 1)
  renderer.init({
    mainCanvas: main,
    decorationsCanvas: decorations,
    options: resolveMinimapOptions({
      renderCharacters: options.renderCharacters,
      maxColumn: 48,
      scale: options.scale,
    }),
    styles,
  })
  return { renderer, main, decorations }
}

function verifyScrolling(pair: RasterPair, label: string, result: PixelOracleResult): void {
  const end = pair.viewport.scrollHeight - pair.viewport.clientHeight
  const positions = [0, 1, 19, 20, 21, 40, 39, 480, 520, 5000, 5001, 5080, end - 1, end, 520, 0]
  for (const scrollTop of positions) {
    scrollPair(pair, scrollTop)
    verifyFrame(pair, `${label} scroll ${scrollTop}`, result)
  }
}

function scrollPair(pair: RasterPair, scrollTop: number): void {
  pair.viewport = {
    ...pair.viewport,
    scrollTop,
    scrollRow: scrollTop / pair.metrics.rowHeight,
    visibleStart: scrollTop / pair.metrics.rowHeight,
    visibleEnd: (scrollTop + pair.viewport.clientHeight) / pair.metrics.rowHeight,
  }
  pair.actual.renderer.updateViewport(pair.viewport)
  pair.expected.renderer.updateViewport(pair.viewport)
}

function verifyMutations(pair: RasterPair, label: string, result: PixelOracleResult): void {
  const color = { r: 255, g: 42, b: 113, a: 255 }
  const token = pair.document.tokens[6]!
  const patch = { start: 6, deleteCount: 1, tokens: [{ ...token, color }] }
  pair.actual.renderer.updateTokenRange(patch)
  pair.expected.renderer.updateTokenRange(patch)
  verifyFrame(pair, `${label} token patch`, result)
  replaceLine(pair, 2, 'updated XXXXX\tlong content 123456789')
  verifyFrame(pair, `${label} text edit`, result)
  insertLine(pair, 4, '// MARK: Inserted')
  verifyFrame(pair, `${label} multiline edit`, result)

  for (const target of [pair.actual, pair.expected]) {
    target.renderer.setSelections([{ startOffset: 0, endOffset: pair.document.lineStarts[3]! }])
    target.renderer.setExternalDecorations([
      {
        startLineNumber: 2,
        endLineNumber: 5,
        startColumn: 1,
        endColumn: 49,
        color: '#ff0080',
        position: 'gutter',
      },
      {
        startLineNumber: 7,
        endLineNumber: 7,
        startColumn: 1,
        endColumn: 49,
        color: '#00ff80',
        position: 'inline',
      },
    ])
  }
  verifyFrame(pair, `${label} selections and markers`, result)
  scrollPair(pair, 140)
  verifyFrame(pair, `${label} decorated scroll`, result)
  pair.styles = { ...pair.styles, minimapBackground: { r: 93, g: 24, b: 61, a: 192 } }
  pair.actual.renderer.setBaseStyles(pair.styles)
  verifyFrame(pair, `${label} background change`, result)
}

function replaceLine(pair: RasterPair, line: number, text: string): void {
  const previous = pair.document
  const lines = previous.lines.map((summary) => summary.text)
  lines[line] = text
  pair.document = documentPayload(lines)
  const edit = {
    from: previous.lineStarts[line]!,
    to: previous.lineStarts[line]! + previous.lines[line]!.length,
    text,
  }
  const summaryPatch = {
    startLine: line,
    deleteCount: 1,
    lines: [pair.document.lines[line]!],
    textLength: pair.document.textLength,
  }
  pair.actual.renderer.applyEdit(edit, { selections: [], summaryPatch })
  pair.expected.renderer.applyEdit(edit, { selections: [], summaryPatch })
}

function insertLine(pair: RasterPair, line: number, text: string): void {
  const previous = pair.document
  const lines = previous.lines.map((summary) => summary.text)
  lines.splice(line, 0, text)
  pair.document = documentPayload(lines)
  const edit = {
    from: previous.lineStarts[line]!,
    to: previous.lineStarts[line]!,
    text: `${text}\n`,
  }
  const summaryPatch = {
    startLine: line,
    deleteCount: 0,
    lines: [pair.document.lines[line]!],
    textLength: pair.document.textLength,
  }
  pair.actual.renderer.applyEdit(edit, { selections: [], summaryPatch })
  pair.expected.renderer.applyEdit(edit, { selections: [], summaryPatch })
}

function verifyLayoutChanges(pair: RasterPair, label: string, result: PixelOracleResult): void {
  pair.metrics = { ...pair.metrics, devicePixelRatio: pair.metrics.devicePixelRatio === 2 ? 1 : 2 }
  pair.viewport = { ...pair.viewport, clientWidth: 190, clientHeight: 103, minimapHeight: 103 }
  pair.actual.renderer.updateLayout(pair.metrics, pair.viewport)
  pair.expected.renderer.updateLayout(pair.metrics, pair.viewport)
  verifyFrame(pair, `${label} resize and DPR change`, result)
  scrollPair(pair, 340)
  verifyFrame(pair, `${label} scroll after resize`, result)
  pair.actual.renderer.setTokens(pair.document.tokens)
  pair.expected.renderer.setTokens(pair.document.tokens)
  verifyFrame(pair, `${label} token replacement`, result)
}

function verifyFrame(pair: RasterPair, label: string, result: PixelOracleResult) {
  // Preserve prior geometry while forcing the reference to redraw every pixel.
  pair.expected.renderer.setBaseStyles(pair.styles)
  const actual = pair.actual.renderer.render()
  const expected = pair.expected.renderer.render()
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw oracleError(`${label}: geometry`)
  result.comparedBytes += compareCanvases(pair.actual.main, pair.expected.main, `${label}: code`)
  result.comparedBytes += compareCanvases(
    pair.actual.decorations,
    pair.expected.decorations,
    `${label}: decorations`,
  )
  result.frames += 1
  return actual
}

function compareCanvases(
  actual: OffscreenCanvas,
  expected: OffscreenCanvas,
  label: string,
): number {
  if (actual.width !== expected.width || actual.height !== expected.height) {
    throw oracleError(`${label}: dimensions`)
  }
  const actualPixels = canvasPixels(actual)
  const expectedPixels = canvasPixels(expected)
  for (let index = 0; index < expectedPixels.length; index += 1) {
    if (actualPixels[index] === expectedPixels[index]) continue
    throw oracleError(`${label}: byte ${index}, ${actualPixels[index]} != ${expectedPixels[index]}`)
  }
  return actualPixels.length
}

function canvasPixels(canvas: OffscreenCanvas): Uint8ClampedArray {
  const context = canvas.getContext('2d')
  if (!context) throw oracleError('Missing OffscreenCanvas 2D context')
  return context.getImageData(0, 0, canvas.width, canvas.height).data
}

function verifyOverlappingTokens(result: PixelOracleResult): void {
  const pair = createPair({ dpr: 1, renderCharacters: false, alpha: 0, scale: 1 })
  const spanning = { start: 0, end: pair.document.textLength, color: tokenColor(7) }
  const tokens = [spanning, ...pair.document.tokens.filter((token) => token.end < 2000)]
  try {
    pair.actual.renderer.setTokens(tokens)
    pair.expected.renderer.setTokens([spanning])
    scrollPair(pair, 5100)
    verifyFrame(pair, 'overlapping token lookup', result)
  } finally {
    pair.actual.renderer.dispose()
    pair.expected.renderer.dispose()
  }
}

function verifyPixelSnappedMotion(dpr: number, result: PixelOracleResult): void {
  const pair = createPair({ dpr, renderCharacters: false, alpha: 0, scale: 1 })
  pair.document = documentPayload(
    Array.from({ length: 300 }, (_, line) => (line === 8 ? 'XXXXX' : '')),
  )
  for (const target of [pair.actual, pair.expected]) {
    target.renderer.setDocument(pair.document)
    target.renderer.setExternalDecorations([
      {
        startLineNumber: 9,
        endLineNumber: 9,
        startColumn: 1,
        endColumn: 6,
        color: '#ff0000',
        position: 'gutter',
      },
    ])
  }
  try {
    verifySnappedFrames(pair, result)
  } finally {
    pair.actual.renderer.dispose()
    pair.expected.renderer.dispose()
  }
}

function verifySnappedFrames(pair: RasterPair, result: PixelOracleResult): void {
  const layout = pair.actual.renderer.updateLayout(pair.metrics, pair.viewport)
  if (!layout) throw oracleError('Missing pixel-snapping layout')
  verifyFrame(pair, 'pixel-snapped origin', result)
  const initialPixels = canvasPixels(pair.actual.main)
  const initialMarkers = canvasPixels(pair.actual.decorations)
  const initialCodeY = alphaCentroid(pair.actual.main, 2)
  const initialMarkerY = alphaCentroid(pair.actual.decorations, pair.actual.decorations.width - 1)
  for (let index = 0; index < 3; index += 1) pair.actual.renderer.render()
  if (!pixelsEqual(initialPixels, canvasPixels(pair.actual.main))) {
    throw oracleError('Unchanged snapped frame accumulates transparent pixels')
  }
  let movedOnePixel = false
  for (let scrollTop = 2; scrollTop <= 60; scrollTop += 2) {
    scrollPair(pair, scrollTop)
    const frame = verifyFrame(pair, `pixel-snapped scroll ${scrollTop}`, result)
    if (!frame) throw oracleError('Missing pixel-snapping frame')
    const codeDelta = alphaCentroid(pair.actual.main, 2) - initialCodeY
    const markerDelta =
      alphaCentroid(pair.actual.decorations, pair.actual.decorations.width - 1) - initialMarkerY
    const shift = Math.round(codeDelta)
    const pixelRatio = layout.canvasInnerHeight / layout.canvasOuterHeight
    const continuousOffset =
      pair.viewport.visibleStart * layout.lineHeight - frame.sliderTop * pixelRatio
    if (Math.abs(codeDelta + continuousOffset) > 0.500001)
      throw oracleError(`Snapped code exceeded half-pixel position error at ${scrollTop}px`)
    if (Math.abs(codeDelta - shift) > 0.000001 || Math.abs(codeDelta - markerDelta) > 0.000001)
      throw oracleError(`Code and marker must move together by whole pixels at ${scrollTop}px`)
    compareShiftedPixels(pair.actual.main, initialPixels, shift, 'code')
    compareShiftedPixels(pair.actual.decorations, initialMarkers, shift, 'marker')
    movedOnePixel ||= shift === -1
  }
  if (!movedOnePixel) throw oracleError('Expected a physical-pixel step smaller than a minimap row')
}

function compareShiftedPixels(
  canvas: OffscreenCanvas,
  initial: Uint8ClampedArray,
  shift: number,
  label: string,
): void {
  const pixels = canvasPixels(canvas)
  const offset = shift * canvas.width * 4
  for (let index = 0; index < pixels.length; index += 1) {
    if (pixels[index] === (initial[index - offset] ?? 0)) continue
    throw oracleError(`Pixel-snapped ${label} changed color or opacity at byte ${index}`)
  }
}

function pixelsEqual(left: Uint8ClampedArray, right: Uint8ClampedArray): boolean {
  if (left.length !== right.length) return false
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function alphaCentroid(canvas: OffscreenCanvas, x: number): number {
  const context = canvas.getContext('2d')
  if (!context) throw oracleError('Missing centroid context')
  const pixels = context.getImageData(x, 0, 1, canvas.height).data
  let weight = 0
  let weightedY = 0
  for (let y = 0; y < canvas.height; y += 1) {
    const alpha = pixels[y * 4 + 3]!
    weight += alpha
    weightedY += y * alpha
  }
  if (weight === 0) throw oracleError('Expected painted code or marker in centroid column')
  return weightedY / weight
}

function fixtureLine(line: number): string {
  if (line % 53 === 0) return `// MARK: Section ${line}`
  if (line % 11 === 0) return ''
  return `${' '.repeat(line % 6)}const value${line} = "${'XY'.repeat(8 + (line % 23))}";\tend`
}

function documentPayload(textLines: readonly string[]): MinimapDocumentPayload {
  const lineStarts: number[] = []
  const tokens: MinimapToken[] = []
  let offset = 0
  for (const [line, text] of textLines.entries()) {
    lineStarts.push(offset)
    if (text.length > 0)
      tokens.push({ start: offset, end: offset + text.length, color: tokenColor(line) })
    offset += text.length + 1
  }
  return {
    textLength: Math.max(0, offset - 1),
    lineStarts,
    lines: textLines.map((text) => ({ text, length: text.length })),
    tokens,
    selections: [],
    decorations: [],
  }
}

function tokenColor(line: number): RGBA8 {
  return {
    r: 80 + ((line * 17) % 176),
    g: 80 + ((line * 37) % 176),
    b: 80 + ((line * 53) % 176),
    a: 255,
  }
}

function viewportForDocument(document: MinimapDocumentPayload): MinimapViewport {
  return {
    scrollTop: 0,
    scrollRow: 0,
    scrollLeft: 0,
    scrollHeight: document.lines.length * 20,
    scrollWidth: 800,
    clientHeight: 85,
    clientWidth: 640,
    minimapHeight: 85,
    reservedWidth: 0,
    visibleStart: 0,
    visibleEnd: 5,
  }
}

function baseStyles(alpha: number): MinimapBaseStyles {
  return {
    background: { r: 13, g: 19, b: 31, a: 255 },
    foreground: { r: 219, g: 227, b: 241, a: 255 },
    foregroundOpacity: 1,
    selection: { r: 35, g: 94, b: 211, a: 255 },
    minimapBackground: { r: 13, g: 19, b: 31, a: alpha },
    slider: 'transparent',
    sliderHover: 'transparent',
    sliderActive: 'transparent',
    fontFamily: 'monospace',
  }
}

function oracleError(why: string): Error {
  return createError({
    message: 'Minimap raster differs from a complete repaint',
    code: 'MINIMAP_PIXEL_ORACLE',
    status: 500,
    why,
    fix: 'Check raster overlap, invalidation, and token lookup for the reported frame.',
  })
}
