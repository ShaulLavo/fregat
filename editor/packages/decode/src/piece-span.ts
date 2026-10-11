/** What an overlay span needs to stand exactly over its text in the real row. */
export type SpanPiece = {
  readonly text: string
  readonly x: number
  readonly top: number
  readonly height: number
  readonly fontStyle: string | undefined
  readonly fontWeight: string | number | undefined
}

const PIECE_CLASS = 'editor-morph-piece'

/** Appends an absolutely positioned span for `piece` to `layer`, showing `text` (its own by default). */
export function appendPieceSpan(
  layer: HTMLElement,
  piece: SpanPiece,
  color: string | undefined,
  text = piece.text,
): HTMLElement {
  const span = layer.ownerDocument.createElement('span')
  span.className = PIECE_CLASS
  span.textContent = text
  const style = span.style
  style.left = `${piece.x}px`
  style.top = `${piece.top}px`
  style.height = `${piece.height}px`
  style.lineHeight = `${piece.height}px`
  if (color) style.color = color
  if (piece.fontStyle) style.fontStyle = piece.fontStyle
  if (piece.fontWeight !== undefined) style.fontWeight = String(piece.fontWeight)
  layer.appendChild(span)
  return span
}

/** Fires `onDone` once every animation has finished, unless `isCanceled` says the run was cut short. */
export function whenAllFinished(
  animations: readonly Animation[],
  isCanceled: () => boolean,
  onDone: () => void,
): void {
  const fire = () => {
    if (!isCanceled()) onDone()
  }
  if (animations.length === 0) {
    /**
     * @justification A run with nothing to animate still settles after its constructor returns, so
     * the owner has stored the run before `onDone` tears it down. Guarded by `isCanceled`.
     */
    queueMicrotask(fire)
    return
  }
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(fire)
}
