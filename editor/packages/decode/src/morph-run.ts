import type { MorphFrame, MorphPiece } from './morph-frame'

const LAYER_CLASS = 'editor-morph-layer'
const PIECE_CLASS = 'editor-morph-piece'
// Entering text starts this blurred (px) and this far below its row (share of the row height).
const ENTER_BLUR_PX = 3
const ENTER_DROP = 0.18
const LEAVE_BLUR_PX = 2

/** Where a piece is on screen right now, which may be part way through an earlier morph. */
export type VisualPiece = {
  readonly text: string
  readonly x: number
  readonly top: number
  readonly height: number
  readonly opacity: number
  /** Gaussian blur radius in px. */
  readonly blur: number
  readonly color: string | undefined
  readonly fontStyle: string | undefined
  readonly fontWeight: string | number | undefined
}

export type MorphTiming = {
  readonly durationMs: number
  /** A `linear()` spring when the browser supports it; the move curve. */
  readonly moveEasing: string
}

type Target = {
  readonly piece: MorphPiece
  readonly span: HTMLElement
  /** Offset from the final spot, opacity and blur the piece starts from. */
  readonly fromX: number
  readonly fromY: number
  readonly fromOpacity: number
  readonly fromBlur: number
  readonly animation: Animation | null
}

type Leaving = {
  readonly visual: VisualPiece
  readonly span: HTMLElement
  readonly animation: Animation | null
}

/**
 * One morph from what is on screen to a new frame, drawn on an overlay above
 * the hidden rows. Every motion is a two-keyframe WAAPI animation with its
 * curve on the effect, so `getComputedTiming().progress` is the eased progress
 * and the current position of any piece is arithmetic: a later morph starts
 * each piece from where it is, without reading layout.
 */
export class MorphRun {
  private readonly layer: HTMLElement
  private readonly targets: Target[] = []
  private readonly leaving: Leaving[] = []
  private canceled = false
  private colorFrame = 0

  public constructor(
    private readonly host: HTMLElement,
    private readonly frame: MorphFrame,
    from: readonly VisualPiece[],
    pairs: Int32Array,
    timing: MorphTiming,
    onDone: () => void,
  ) {
    const document = host.ownerDocument
    this.layer = document.createElement('div')
    this.layer.className = LAYER_CLASS
    this.layer.setAttribute('aria-hidden', 'true')

    const used = new Uint8Array(from.length)
    for (const old of pairs) if (old >= 0) used[old] = 1
    from.forEach((visual, index) => {
      if (used[index] || visual.opacity <= 0.01) return
      this.leaving.push(this.leave(visual, timing))
    })
    const enterCount = pairs.reduce((count, old) => count + (old < 0 ? 1 : 0), 0)
    let enterOrder = 0
    const recolor: [HTMLElement, string][] = []
    frame.pieces.forEach((piece, index) => {
      const old = from[pairs[index] ?? -1]
      if (!old) {
        this.targets.push(this.enter(piece, enterOrder, enterCount, timing))
        enterOrder += 1
        return
      }
      const target = this.move(piece, old, frame.rowCount, timing)
      this.targets.push(target)
      const color = piece.color ?? old.color
      if (color && color !== old.color) recolor.push([target.span, color])
    })
    host.appendChild(this.layer)
    this.scheduleRecolor(recolor)
    this.whenSettled(onDone)
  }

  /** Every piece where it is drawn now, for the next morph to start from. */
  public visualPieces(): VisualPiece[] {
    const pieces = this.targets.map((target) => {
      const progress = easedProgress(target.animation)
      const remaining = 1 - progress
      return {
        ...visualOf(target.piece, target.span),
        x: target.piece.x + target.fromX * remaining,
        top: target.piece.top + target.fromY * remaining,
        opacity: target.fromOpacity + (1 - target.fromOpacity) * progress,
        blur: target.fromBlur * remaining,
      }
    })
    const leaving = this.leaving.map((entry) => {
      const progress = easedProgress(entry.animation)
      return {
        ...entry.visual,
        opacity: entry.visual.opacity * (1 - progress),
        blur: entry.visual.blur + (LEAVE_BLUR_PX - entry.visual.blur) * progress,
      }
    })
    return pieces.concat(leaving)
  }

  /** The frame this run settles on. */
  public get targetFrame(): MorphFrame {
    return this.frame
  }

  /** A later token pass coloured the new text; fade the overlay to it. */
  public recolor(colors: readonly (string | undefined)[]): void {
    this.targets.forEach((target, index) => {
      const color = colors[index]
      if (color && target.span.style.color !== color) target.span.style.color = color
    })
  }

  public cancel(): void {
    this.canceled = true
    cancelAnimationFrame(this.colorFrame)
    for (const target of this.targets) target.animation?.cancel()
    for (const entry of this.leaving) entry.animation?.cancel()
    this.layer.remove()
  }

  private move(piece: MorphPiece, old: VisualPiece, rowCount: number, timing: MorphTiming): Target {
    const span = this.span(piece, old.color ?? piece.color)
    const fromX = old.x - piece.x
    const fromY = old.top - piece.top
    const fromOpacity = old.opacity
    const fromBlur = old.blur
    if (Math.abs(fromX) < 0.5 && Math.abs(fromY) < 0.5 && fromOpacity >= 0.99 && fromBlur < 0.05) {
      return { piece, span, fromX: 0, fromY: 0, fromOpacity: 1, fromBlur: 0, animation: null }
    }
    // A downward wave: rows lower in the frame set off slightly later.
    const wave = rowCount > 1 ? piece.row / (rowCount - 1) : 0
    const delay = timing.durationMs * 0.1 * wave
    const animation = span.animate(
      [
        {
          transform: `translate(${fromX}px, ${fromY}px)`,
          opacity: fromOpacity,
          filter: `blur(${fromBlur}px)`,
        },
        { transform: 'translate(0, 0)', opacity: 1, filter: 'blur(0)' },
      ],
      {
        duration: timing.durationMs * 0.85,
        delay,
        easing: timing.moveEasing,
        fill: 'both',
      },
    )
    return { piece, span, fromX, fromY, fromOpacity, fromBlur, animation }
  }

  // New text arrives in reading order, like a stream, after the old text has made room.
  private enter(piece: MorphPiece, order: number, count: number, timing: MorphTiming): Target {
    const span = this.span(piece, piece.color)
    const spread = count > 1 ? order / (count - 1) : 0
    const drop = piece.height * ENTER_DROP
    const animation = span.animate(
      [
        { opacity: 0, filter: `blur(${ENTER_BLUR_PX}px)`, transform: `translateY(${drop}px)` },
        { opacity: 1, filter: 'blur(0)', transform: 'translateY(0)' },
      ],
      {
        duration: timing.durationMs * 0.4,
        delay: timing.durationMs * (0.22 + 0.4 * spread),
        easing: 'cubic-bezier(0.2, 0, 0, 1)',
        fill: 'both',
      },
    )
    return {
      piece,
      span,
      fromX: 0,
      fromY: drop,
      fromOpacity: 0,
      fromBlur: ENTER_BLUR_PX,
      animation,
    }
  }

  private leave(visual: VisualPiece, timing: MorphTiming): Leaving {
    const span = this.span(visual, visual.color)
    const animation = span.animate(
      [
        { opacity: visual.opacity, filter: `blur(${visual.blur}px)` },
        { opacity: 0, filter: `blur(${LEAVE_BLUR_PX}px)` },
      ],
      { duration: timing.durationMs * 0.25, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'both' },
    )
    return { visual, span, animation }
  }

  private span(
    piece: Omit<VisualPiece, 'opacity' | 'blur'>,
    color: string | undefined,
  ): HTMLElement {
    const span = this.host.ownerDocument.createElement('span')
    span.className = PIECE_CLASS
    span.textContent = piece.text
    const style = span.style
    style.left = `${piece.x}px`
    style.top = `${piece.top}px`
    style.height = `${piece.height}px`
    style.lineHeight = `${piece.height}px`
    if (color) style.color = color
    if (piece.fontStyle) style.fontStyle = piece.fontStyle
    if (piece.fontWeight !== undefined) style.fontWeight = String(piece.fontWeight)
    this.layer.appendChild(span)
    return span
  }

  private scheduleRecolor(recolor: readonly [HTMLElement, string][]): void {
    if (recolor.length === 0) return
    /**
     * @justification Colour changes ride a CSS transition, which needs the starting colour painted
     * first. One frame per morph, cancelled with the run.
     */
    this.colorFrame = requestAnimationFrame(() => {
      for (const [span, color] of recolor) span.style.color = color
    })
  }

  private whenSettled(onDone: () => void): void {
    const animations = this.targets
      .map((target) => target.animation)
      .concat(this.leaving.map((entry) => entry.animation))
      .filter((animation): animation is Animation => animation !== null)
    const fire = () => {
      if (!this.canceled) onDone()
    }
    if (animations.length === 0) {
      /**
       * @justification A run with nothing to animate still settles after its constructor returns, so
       * the owner has stored the run before `onDone` tears it down. Guarded by `canceled`.
       */
      queueMicrotask(fire)
      return
    }
    void Promise.allSettled(animations.map((animation) => animation.finished)).then(fire)
  }
}

/** The frame's pieces as they would stand with nothing animating. */
export function restingPieces(frame: MorphFrame): VisualPiece[] {
  return frame.pieces.map((piece) => ({ ...piece, opacity: 1, blur: 0 }))
}

function visualOf(piece: MorphPiece, span: HTMLElement): Omit<VisualPiece, 'opacity' | 'blur'> {
  return {
    text: piece.text,
    x: piece.x,
    top: piece.top,
    height: piece.height,
    color: span.style.color || piece.color,
    fontStyle: piece.fontStyle,
    fontWeight: piece.fontWeight,
  }
}

function easedProgress(animation: Animation | null): number {
  if (!animation) return 1
  const progress = animation.effect?.getComputedTiming().progress
  if (progress === null || progress === undefined) return animation.playState === 'finished' ? 1 : 0
  return progress
}

/**
 * A damped spring sampled into a CSS `linear()` curve: a slight overshoot that
 * settles by the end of the animation. Falls back to an ease-out curve where
 * `linear()` is unsupported.
 */
export function springEasing(bounce: number, supportsLinear: boolean): string {
  if (!supportsLinear) return 'cubic-bezier(0.2, 0, 0, 1)'
  const damping = Math.min(0.99, Math.max(0.3, 1 - bounce))
  // Settles to within 0.1% at t = 1.
  const omega = Math.log(1000) / damping
  const damped = omega * Math.sqrt(1 - damping * damping)
  const samples: string[] = []
  const count = 40
  for (let index = 0; index <= count; index += 1) {
    const t = index / count
    const decay = Math.exp(-damping * omega * t)
    const value =
      index === count
        ? 1
        : 1 - decay * (Math.cos(damped * t) + ((damping * omega) / damped) * Math.sin(damped * t))
    samples.push(value.toFixed(4))
  }
  return `linear(${samples.join(', ')})`
}
