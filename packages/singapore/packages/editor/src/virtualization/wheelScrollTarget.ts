import type { EditorViewContributionContext } from '../plugins'
import type { EditorDisposable } from '../editor/disposables'

/** Native access is supplied by the scroll owner, before it exposes logical DOM offsets. */
export type NativeWheelScrollOptions = {
  readScrollTop(): number
  readScrollHeight(): number
  lineHeight(): number
  isEnabled(): boolean
  canScrollVertically(): boolean
  onScrolled(): void
}

const owners = new WeakMap<HTMLElement, NativeWheelScrollOwner>()

/** Internal: the virtualizer owns this registration for exactly as long as it is attached. */
export function installNativeWheelScrollOwner(
  element: HTMLElement,
  options: NativeWheelScrollOptions,
): EditorDisposable {
  const owner = new NativeWheelScrollOwner(element, options)
  owners.set(element, owner)
  return {
    dispose: () => {
      if (owners.get(element) === owner) owners.delete(element)
    },
  }
}

/**
 * Opt an external overlay into the editor's native scroll pipeline. Do not register a native
 * descendant or a shared ancestor: those would make ordinary editor scrolling wait for JS.
 * Disposing the contribution must dispose this registration as well.
 */
export function registerWheelScrollTarget(
  context: Pick<EditorViewContributionContext, 'scrollElement'>,
  target: HTMLElement,
): EditorDisposable {
  const element = context.scrollElement
  if (element.contains(target) || target.contains(element)) {
    throw new Error('Wheel scroll targets must be outside the editor scroll subtree')
  }
  const onWheel = (event: WheelEvent): void => owners.get(element)?.handleWheel(event)
  target.addEventListener('wheel', onWheel, { passive: false })
  return { dispose: () => target.removeEventListener('wheel', onWheel) }
}

class NativeWheelScrollOwner {
  private remainderX = 0
  private remainderY = 0
  private lastLeft = Number.NaN
  private lastTop = Number.NaN

  public constructor(
    private readonly element: HTMLElement,
    private readonly options: NativeWheelScrollOptions,
  ) {}

  public handleWheel(event: WheelEvent): void {
    if (event.defaultPrevented || event.ctrlKey || !event.cancelable) return
    if (!this.options.isEnabled()) {
      this.remainderX = 0
      this.remainderY = 0
      return
    }

    // Read the mode before the deltas; some browsers choose their units when it is read.
    const mode = event.deltaMode
    let x = event.deltaX
    let y = event.deltaY
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (event.shiftKey && x === 0) {
      x = y
      y = 0
    }
    if (x === 0 && y === 0) return

    const element = this.element
    const width = element.clientWidth
    const height = element.clientHeight
    if (width <= 0 || height <= 0) return
    const lineHeight = this.options.lineHeight()
    if (mode === 1) {
      x *= lineHeight
      y *= lineHeight
    } else if (mode === 2) {
      x *= width
      y *= height
    }

    const style = element.ownerDocument.defaultView?.getComputedStyle(element)
    const scrollsX = style?.overflowX !== 'hidden' && style?.overflowX !== 'clip'
    const scrollsY =
      this.options.canScrollVertically() &&
      style?.overflowY !== 'hidden' &&
      style?.overflowY !== 'clip'
    const maxLeft = scrollsX ? Math.max(0, element.scrollWidth - width) : 0
    const maxTop = scrollsY ? Math.max(0, this.options.readScrollHeight() - height) : 0
    const left = element.scrollLeft
    const top = this.options.readScrollTop()
    const canX = scrollsX && canMove(left, maxLeft, x)
    const canY = scrollsY && canMove(top, maxTop, y)
    if (left !== this.lastLeft || !canX) this.remainderX = 0
    if (top !== this.lastTop || !canY) this.remainderY = 0

    // Decide consumption in native coordinates, including subpixel input that rounds to zero.
    // At a boundary, let the original event chain unless the editor's CSS forbids it.
    const containX = scrollsX && x !== 0 && containsScroll(style?.overscrollBehaviorX)
    const containY = scrollsY && y !== 0 && containsScroll(style?.overscrollBehaviorY)
    if (!canX && !canY && !containX && !containY) return
    event.preventDefault()
    if (!canX && !canY) return

    const targetLeft = canX ? clamp(left + this.remainderX + x, maxLeft) : left
    const targetTop = canY ? clamp(top + this.remainderY + y, maxTop) : top
    element.scrollBy({ left: targetLeft - left, top: targetTop - top, behavior: 'instant' })
    this.lastLeft = element.scrollLeft
    this.lastTop = this.options.readScrollTop()
    this.remainderX = canX ? targetLeft - this.lastLeft : 0
    this.remainderY = canY ? targetTop - this.lastTop : 0
    // Chromium delivers the scroll event a frame late; a queued resize flush would rewrite the
    // native offset from the cached logical one first. Schedule the sync now, as the listener would.
    this.options.onScrolled()
  }
}

function canMove(position: number, max: number, delta: number): boolean {
  return (delta < 0 && position > 0) || (delta > 0 && position < max)
}

function clamp(value: number, max: number): number {
  return Math.max(0, Math.min(max, value))
}

function containsScroll(value: string | undefined): boolean {
  return value === 'contain' || value === 'none'
}
