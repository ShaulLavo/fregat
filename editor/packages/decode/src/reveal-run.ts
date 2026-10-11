import type { MorphFrame } from './morph-frame'
import { hash01, scramble, spatialNoise } from './noise'
import type { ResolvedDecodeOptions } from './options'
import { appendPieceSpan, whenAllFinished } from './piece-span'

const LAYER_CLASS = 'editor-decode-layer'
const CARET_CLASS = 'editor-decode-caret'
const CARET_BAR_CLASS = 'editor-decode-caret-bar'

// A typed piece blurs in over this long, so the stream reads as smooth rather than stamped.
const APPEAR_MS = 160
// The caret lingers at the end of its stream before fading.
const CARET_TAIL_MS = 260
// A pause at each line end, in characters' worth of typing.
const LINE_END_CHARS = 3
// Diffusion: the share of the run each piece spends noisy before it locks, and the cluster size
// of the resolve-order field, in characters and rows.
const BAND = 0.24
const CLUSTER_COLUMNS = 12
const CLUSTER_ROWS = 5

type CaretPoint = {
  readonly at: number
  readonly x: number
  readonly top: number
  readonly height: number
}

/**
 * A file-open reveal drawn on an overlay above the hidden rows, with every motion a WAAPI
 * animation on opacity, filter or transform, so it keeps time on the compositor while the page
 * is busy opening the file. The modes differ only in when each piece appears and how:
 * `autoregressive` streams pieces in reading order at the typing rate, `token` stamps one piece
 * per `perTokenMs`, `parallel` streams every row at once from staggered starts, and `diffusion`
 * resolves scrambled pieces in spatial clusters.
 */
export class RevealRun {
  private readonly layer: HTMLElement
  private readonly spans: HTMLElement[] = []
  private readonly animations: Animation[] = []
  private canceled = false

  public constructor(
    host: HTMLElement,
    frame: MorphFrame,
    options: ResolvedDecodeOptions,
    widthOf: (text: string) => number,
    onDone: () => void,
  ) {
    this.layer = host.ownerDocument.createElement('div')
    this.layer.className = LAYER_CLASS
    this.layer.setAttribute('aria-hidden', 'true')
    for (const piece of frame.pieces)
      this.spans.push(appendPieceSpan(this.layer, piece, piece.color))

    if (options.mode === 'diffusion') this.diffuse(frame, options, widthOf)
    else this.stream(frame, options, widthOf)

    host.appendChild(this.layer)
    whenAllFinished(this.animations, () => this.canceled, onDone)
  }

  /** A later token pass coloured the text; the overlay fades to it. */
  public recolor(colors: readonly (string | undefined)[]): void {
    this.spans.forEach((span, index) => {
      const color = colors[index]
      if (color && span.style.color !== color) span.style.color = color
    })
  }

  public cancel(): void {
    this.canceled = true
    for (const animation of this.animations) animation.cancel()
    this.layer.remove()
  }

  private stream(
    frame: MorphFrame,
    options: ResolvedDecodeOptions,
    widthOf: (text: string) => number,
  ): void {
    const times = capTimes(streamTimes(frame, options), options.maxDurationMs - APPEAR_MS)
    const stamped = options.mode === 'token'
    frame.pieces.forEach((_, index) => {
      const span = this.spans[index]
      if (!span) return
      this.animations.push(
        stamped
          ? span.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 1,
              delay: times[index] ?? 0,
              easing: 'steps(1, jump-start)',
              fill: 'both',
            })
          : span.animate(
              [
                { opacity: 0, filter: 'blur(3px)', transform: 'translateY(0.15em)' },
                { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
              ],
              {
                duration: APPEAR_MS,
                delay: times[index] ?? 0,
                easing: 'cubic-bezier(0.2, 0, 0, 1)',
                fill: 'both',
              },
            ),
      )
    })
    for (const track of caretTracks(frame, times, options.mode, widthOf)) this.caret(track)
  }

  // Each piece shows two scrambles in turn while its cluster is noisy, then sharpens into its
  // text. The scrambles are fixed strings; only their opacity animates.
  private diffuse(
    frame: MorphFrame,
    options: ResolvedDecodeOptions,
    widthOf: (text: string) => number,
  ): void {
    const run = options.maxDurationMs
    const columnWidth = Math.max(1, widthOf('0'))
    frame.pieces.forEach((piece, index) => {
      const span = this.spans[index]
      if (!span) return
      const field = spatialNoise(piece.x / columnWidth / CLUSTER_COLUMNS, piece.row / CLUSTER_ROWS)
      const bandStart = (1 - BAND) * field * run
      const band = BAND * run
      const timing = { duration: band, delay: bandStart, fill: 'both' as const }
      for (const [variant, frames] of NOISE_FRAMES.entries()) {
        const noise = appendPieceSpan(
          this.layer,
          piece,
          piece.color,
          scramble(piece.text, index * 7 + variant),
        )
        this.animations.push(noise.animate(frames, timing))
      }
      this.animations.push(
        span.animate(
          [
            { opacity: 0, filter: 'blur(2px)', offset: 0 },
            { opacity: 0, filter: 'blur(2px)', offset: 0.62 },
            { opacity: 1, filter: 'blur(0)', offset: 1 },
          ],
          { ...timing, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        ),
      )
    })
  }

  private caret(track: readonly CaretPoint[]): void {
    const first = track[0]
    const last = track.at(-1)
    if (!first || !last) return
    const caret = this.layer.ownerDocument.createElement('div')
    caret.className = CARET_CLASS
    caret.style.height = `${first.height}px`
    const bar = this.layer.ownerDocument.createElement('div')
    bar.className = CARET_BAR_CLASS
    caret.appendChild(bar)
    this.layer.appendChild(caret)

    const start = first.at
    const span = Math.max(1, last.at - start + CARET_TAIL_MS)
    const keyframes: Keyframe[] = track.map((point) => ({
      transform: `translate(${point.x}px, ${point.top}px)`,
      offset: (point.at - start) / span,
      easing: 'step-end',
    }))
    keyframes.push({ transform: `translate(${last.x}px, ${last.top}px)`, offset: 1 })
    const timing = { duration: span, delay: start, fill: 'both' as const }
    this.animations.push(caret.animate(keyframes, timing))
    this.animations.push(
      caret.animate(
        [
          { opacity: 0, offset: 0 },
          { opacity: 1, offset: 0.02 },
          { opacity: 1, offset: 1 - CARET_TAIL_MS / span / 2 },
          { opacity: 0, offset: 1 },
        ],
        timing,
      ),
    )
  }
}

// Two scrambles, each shown for half the noisy band, faint then brighter as the piece resolves.
const NOISE_FRAMES: readonly Keyframe[][] = [
  [
    { opacity: 0, offset: 0 },
    { opacity: 0.35, offset: 0.08 },
    { opacity: 0.35, offset: 0.34 },
    { opacity: 0, offset: 0.34 },
    { opacity: 0, offset: 1 },
  ],
  [
    { opacity: 0, offset: 0 },
    { opacity: 0, offset: 0.34 },
    { opacity: 0.6, offset: 0.34 },
    { opacity: 0.6, offset: 0.62 },
    { opacity: 0, offset: 0.7 },
    { opacity: 0, offset: 1 },
  ],
]

/** When each piece starts to appear, before the cap. */
function streamTimes(frame: MorphFrame, options: ResolvedDecodeOptions): number[] {
  if (options.mode === 'token') return frame.pieces.map((_, index) => index * options.perTokenMs)
  if (options.mode === 'parallel') return parallelTimes(frame, options)

  // Autoregressive: one typist, in reading order, the whitespace between pieces typed too.
  const times: number[] = []
  let typed = 0
  let row = -1
  let rowEnd = 0
  for (const piece of frame.pieces) {
    if (piece.row !== row) {
      if (row >= 0) typed += LINE_END_CHARS
      row = piece.row
      rowEnd = piece.offset
    }
    typed += piece.offset - rowEnd
    times.push(typed * options.perCharMs)
    typed += piece.text.length
    rowEnd = piece.offset + piece.text.length
  }
  return times
}

// Each row starts at a jittered offset and types at a slightly varied speed, so the rows'
// carets scatter across columns instead of advancing in lockstep. A row starts typing at its
// first piece, past the indent. The jitter is a hash of the row, never Math.random, so a reveal
// is reproducible.
function parallelTimes(frame: MorphFrame, options: ResolvedDecodeOptions): number[] {
  let row = -1
  let rowStart = 0
  return frame.pieces.map((piece) => {
    if (piece.row !== row) {
      row = piece.row
      rowStart = piece.offset
    }
    const start = hash01(row * 12.9898 + 1.3) * options.staggerMs
    const speed = 0.8 + 0.4 * hash01(row * 78.233 + 2.7)
    return start + (piece.offset - rowStart) * options.perCharMs * speed
  })
}

/** Scales every time down so the last piece starts by `limit`. */
function capTimes(times: readonly number[], limit: number): number[] {
  const last = times.reduce((max, time) => Math.max(max, time), 0)
  if (last <= limit || last === 0) return times.slice()
  const factor = Math.max(0, limit) / last
  return times.map((time) => time * factor)
}

/** Where each stream's caret stands after each of its pieces appears. */
function caretTracks(
  frame: MorphFrame,
  times: readonly number[],
  mode: ResolvedDecodeOptions['mode'],
  widthOf: (text: string) => number,
): CaretPoint[][] {
  const tracks = new Map<number, CaretPoint[]>()
  frame.pieces.forEach((piece, index) => {
    const key = mode === 'parallel' ? piece.row : 0
    const track = tracks.get(key) ?? []
    if (track.length === 0) tracks.set(key, track)
    track.push({
      at: times[index] ?? 0,
      x: piece.x + widthOf(piece.text),
      top: piece.top,
      height: piece.height,
    })
  })
  return Array.from(tracks.values())
}
