import type {
  EditorViewContributionContext,
  EditorViewSnapshot,
} from '@singapore-editor/core/extensions'
import type { ResolvedDecodeOptions } from './options'
import type { DecodeRevealRow } from './rows'
import type { RevealHandle } from './reveal'

type DecodeTokens = EditorViewSnapshot['tokens']

const LAYER_CLASS = 'editor-decode-glyph-layer'
const ROW_CLASS = 'editor-decode-glyph-row'
const GLYPH_CLASS = 'editor-decode-glyph'

// Discrete sampling steps, like a diffusion sampler. The denoise wavefront
// advances one step per tick; 64 steps over the run reads as smooth refinement.
const SAMPLING_STEPS = 64
// Each cell is only noisy during a short band (in run-progress units) as the
// wavefront crosses its threshold, then it locks — so nothing scrambles for long.
const BAND = 0.16
// Re-roll the noisy glyph only every N steps, so a cell shows a few characters
// while resolving rather than strobing every frame.
const SCRAMBLE_EVERY = 2
// Faintest a just-emerged glyph gets; it brightens to full as it locks.
const MIN_OPACITY = 0.25
// Cluster size of the resolve-order noise field, in characters / rows. Bigger =
// larger blobs sharpen together.
const CLUSTER_COLS = 12
const CLUSTER_ROWS = 5
// Glyphs a still-noisy position flickers through.
const GLYPHS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789{}[]()<>/\\|=+-*&^%$#@!?;:.'
// Safety cap so a giant viewport can't spawn tens of thousands of spans.
// Overflow characters render as static plain text (no diffusion).
const MAX_GLYPHS = 1500

type GlyphCell = {
  readonly span: HTMLElement
  readonly real: string
  readonly index: number
  /** Run progress (0..1) by which the wavefront has fully resolved this cell. */
  readonly threshold: number
}

/**
 * Diffusion reveal. The real rows stay clipped-hidden the whole time (clip hides
 * geometry, which works even though the workbench editor background is
 * transparent — there is nothing to "cover" with). An overlay denoises into the
 * file over `SAMPLING_STEPS` discrete steps: a wavefront sweeps a smooth 2D noise
 * field, so spatial clusters of glyphs emerge and sharpen together (blobs in the
 * middle, the end, wherever — not a left-to-right wipe). A cell is empty ahead of
 * the front, noisy and brightening within a short `BAND` as the front crosses it,
 * then locked to its real character. Every glyph already wears its final syntax
 * colour, so at completion the overlay matches the real rows exactly and `onDone`
 * un-clips them and drops the overlay with no visible seam.
 */
export function runDiffusion(
  context: EditorViewContributionContext,
  rows: readonly DecodeRevealRow[],
  tokens: DecodeTokens,
  options: ResolvedDecodeOptions,
  onDone: () => void,
): RevealHandle {
  const document = context.scrollElement.ownerDocument
  const layer = document.createElement('div')
  layer.className = LAYER_CLASS
  layer.setAttribute('aria-hidden', 'true')

  const cells = buildCells(document, layer, rows, tokens)
  context.contentElement.appendChild(layer)

  return drive(cells, layer, options.maxDurationMs, onDone)
}

/** Builds the overlay rows (all blank to start) and returns the diffusing cells. */
function buildCells(
  document: Document,
  layer: HTMLElement,
  rows: readonly DecodeRevealRow[],
  tokens: DecodeTokens,
): GlyphCell[] {
  const colorAt = tokenColorLookup(tokens)
  const cells: GlyphCell[] = []
  let rowOrdinal = 0
  for (const row of rows) {
    const rowElement = document.createElement('div')
    rowElement.className = ROW_CLASS
    rowElement.style.top = `${row.top}px`
    rowElement.style.marginLeft = `${row.leftSpacerWidth}px`
    appendRowGlyphs(document, rowElement, row, rowOrdinal, cells, colorAt)
    layer.appendChild(rowElement)
    rowOrdinal += 1
    if (cells.length >= MAX_GLYPHS) break
  }
  return cells
}

// Whitespace is emitted as plain text (nothing to diffuse, and it keeps the
// following columns aligned). Every visible character gets a span that starts
// blank, already carries its final syntax colour, and gets a resolve threshold
// from a smooth 2D field so neighbours resolve as a cluster.
function appendRowGlyphs(
  document: Document,
  rowElement: HTMLElement,
  row: DecodeRevealRow,
  rowOrdinal: number,
  cells: GlyphCell[],
  colorAt: (offset: number) => string | undefined,
): void {
  for (let column = 0; column < row.text.length; column += 1) {
    const char = row.text[column] ?? ''
    if (isWhitespace(char) || cells.length >= MAX_GLYPHS) {
      rowElement.appendChild(document.createTextNode(char))
      continue
    }
    const span = document.createElement('span')
    span.className = GLYPH_CLASS
    span.style.color = colorAt(row.startOffset + column) ?? 'inherit'
    // Start as a blank space, never '' — an empty inline span is zero-width, so
    // unresolved cells would collapse and the row would pack in from the left. A
    // space holds the column, so each glyph resolves in its true scattered spot.
    span.textContent = ' '
    span.style.opacity = '0'
    rowElement.appendChild(span)
    cells.push({
      span,
      real: char,
      index: cells.length,
      threshold: thresholdAt(column, rowOrdinal),
    })
  }
}

// Resolve order from a smooth 2D field: the threshold lives in [BAND, 1] so at
// progress 0 every cell is still ahead of the wavefront (blank), and the last
// clusters resolve right at the end.
function thresholdAt(column: number, rowOrdinal: number): number {
  const field = spatialNoise(column / CLUSTER_COLS, rowOrdinal / CLUSTER_ROWS)
  return BAND + (1 - BAND) * field
}

/**
 * Maps a document offset to its syntax colour. Tokens are ascending and we read
 * offsets in order, so a single advancing cursor covers the whole pass.
 */
function tokenColorLookup(tokens: DecodeTokens): (offset: number) => string | undefined {
  let cursor = -1
  return (offset) => {
    // The first read finds its place by bisection, so a reveal deep in a file skips the tokens above.
    if (cursor < 0) cursor = tokens.firstEndingAfter(offset)
    while (cursor < tokens.length && tokens.endAt(cursor) <= offset) cursor += 1
    if (cursor >= tokens.length || tokens.startAt(cursor) > offset) return undefined
    return tokens.styleAt(cursor).color
  }
}

/** Advances the wavefront one sampling step per tick, then fires `onDone`. */
function drive(
  cells: readonly GlyphCell[],
  layer: HTMLElement,
  duration: number,
  onDone: () => void,
): RevealHandle {
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(interval)
    layer.remove()
  }

  if (cells.length === 0) {
    /**
     * @justification Nothing to animate still has to finish asynchronously, or a caller that always sees its
     * completion after returning would see it before returning on an empty document. Guarded by
     * `stopped`, so a cancel between the two beats it.
     */
    queueMicrotask(() => {
      if (!stopped) onDone()
    })
    return { cancel: stop }
  }

  const tickMs = Math.max(1, Math.round(duration / SAMPLING_STEPS))
  let step = 0
  /**
   * @justification Drives a fixed-duration decorative overlay at a tick computed from its own duration, and owns
   * the matching `clearInterval` in `stop()`. It paints a layer above the rows rather than editor
   * state, so nothing it does has to be ordered against document work.
   */
  const interval = setInterval(() => {
    step += 1
    const progress = step / SAMPLING_STEPS
    for (const cell of cells) renderCell(cell, progress, step)
    if (step < SAMPLING_STEPS) return
    stop()
    onDone()
  }, tickMs)

  return { cancel: stop }
}

function renderCell(cell: GlyphCell, progress: number, step: number): void {
  const phase = progress - cell.threshold
  if (phase < -BAND) {
    setBlank(cell)
    return
  }
  if (phase >= 0) {
    setResolved(cell)
    return
  }
  setDenoising(cell, (phase + BAND) / BAND, step)
}

// A space, not '' — keeps the cell one column wide so neighbours don't shift.
function setBlank(cell: GlyphCell): void {
  cell.span.textContent = ' '
  cell.span.style.opacity = '0'
}

function setResolved(cell: GlyphCell): void {
  cell.span.textContent = cell.real
  cell.span.style.opacity = '1'
}

// Within the wavefront band: brighten with band position, and grow likelier to
// show the real glyph as it nears locking (a few corrections), otherwise a slow
// noisy glyph. `band` runs 0 (just emerged) → 1 (about to lock).
function setDenoising(cell: GlyphCell, band: number, step: number): void {
  cell.span.style.opacity = `${MIN_OPACITY + (1 - MIN_OPACITY) * band}`
  const seed = Math.floor(step / SCRAMBLE_EVERY)
  const correct = hash01(cell.index * 131.7 + seed * 0.917 + 7.1) < band
  cell.span.textContent = correct ? cell.real : scrambleGlyph(cell.index, seed)
}

function scrambleGlyph(index: number, seed: number): string {
  const position = Math.floor(hash01(index * 1000.7 + seed * 12.99) * GLYPHS.length)
  return GLYPHS[position] ?? '#'
}

function isWhitespace(char: string): boolean {
  return char.trim().length === 0
}

// Two-octave value noise in ~[0, 1): smooth over space, so nearby cells get
// similar thresholds and resolve as clusters.
function spatialNoise(x: number, y: number): number {
  return 0.65 * valueNoise(x, y) + 0.35 * valueNoise(x * 2 + 5.2, y * 2 + 1.3)
}

function valueNoise(x: number, y: number): number {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const tx = smoothstep(x - x0)
  const ty = smoothstep(y - y0)
  const top = lerp(latticeRandom(x0, y0), latticeRandom(x0 + 1, y0), tx)
  const bottom = lerp(latticeRandom(x0, y0 + 1), latticeRandom(x0 + 1, y0 + 1), tx)
  return lerp(top, bottom, ty)
}

function latticeRandom(ix: number, iy: number): number {
  return hash01(ix * 127.1 + iy * 311.7 + 0.7)
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Deterministic pseudo-random in [0, 1) from a seed (classic sine hash). */
function hash01(seed: number): number {
  const x = Math.sin(seed) * 43758.5453
  return x - Math.floor(x)
}
