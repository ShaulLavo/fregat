import type { TextOffsetRange } from '../textRanges'
import type { VirtualizedTextHitPosition } from '../virtualization/virtualizedTextViewTypes'
import { EditorWorkScheduler } from './workScheduler'

// A hold must survive a finger's small jitter, but a swipe must hand back to native scrolling.
const HOLD_DELAY = 650
const TAP_DELAY = 350
const MOVE_SLOP = 8

type TouchGesture = {
  readonly identifier: number
  readonly x: number
  readonly y: number
  readonly position: VirtualizedTextHitPosition
  range: TextOffsetRange | null
}

type TouchSelectionOptions = {
  readonly element: HTMLElement
  positionAt(x: number, y: number): VirtualizedTextHitPosition | null
  begin(): void
  tap(position: VirtualizedTextHitPosition): void
  word(position: VirtualizedTextHitPosition): TextOffsetRange
  extend(anchor: TextOffsetRange, position: VirtualizedTextHitPosition): void
}

/** Touch owns its gestures; compatibility mouse events must never steal native DOM selection. */
export class TouchSelectionController {
  private gesture: TouchGesture | null = null
  private readonly scheduler = new EditorWorkScheduler()
  private lastTap: { readonly x: number; readonly y: number; readonly time: number } | null = null
  private pointerType = 'mouse'

  constructor(private readonly options: TouchSelectionOptions) {}

  get ownsMouseEvent(): boolean {
    return this.pointerType === 'touch'
  }

  install(): void {
    const element = this.options.element
    element.ownerDocument.addEventListener('pointerdown', this.pointerDown, { capture: true })
    element.addEventListener('touchstart', this.start, { passive: true })
    element.addEventListener('touchmove', this.move, { passive: false })
    element.addEventListener('touchend', this.end)
    element.addEventListener('touchcancel', this.cancel)
  }

  dispose(): void {
    const element = this.options.element
    element.ownerDocument.removeEventListener('pointerdown', this.pointerDown, { capture: true })
    element.removeEventListener('touchstart', this.start)
    element.removeEventListener('touchmove', this.move)
    element.removeEventListener('touchend', this.end)
    element.removeEventListener('touchcancel', this.cancel)
    this.cancel()
    this.scheduler.dispose()
  }

  acceptNativeSelection(): void {
    // Native recognition owns the hold and its callout once it has selected text.
    this.cancel()
  }

  private pointerDown = (event: PointerEvent): void => {
    this.pointerType = event.pointerType
  }

  private start = (event: TouchEvent): void => {
    this.pointerType = 'touch'
    this.clearHold()
    this.gesture = null
    if (event.defaultPrevented || event.touches.length !== 1) {
      this.lastTap = null
      return
    }
    const target = event.target as Element | null
    if (!target?.closest('.editor-virtualized-row')) return
    const finger = event.touches[0]
    if (!finger) return
    const position = this.options.positionAt(finger.clientX, finger.clientY)
    if (!position) return
    const gesture: TouchGesture = {
      identifier: finger.identifier,
      x: finger.clientX,
      y: finger.clientY,
      position,
      range: null,
    }
    this.gesture = gesture
    this.options.begin()
    // Leave touchstart unclaimed so the browser can scroll and present its own selection callout.
    this.scheduler.schedule({
      key: 'touch-selection-hold',
      taskClass: 'input-critical',
      delayMs: HOLD_DELAY,
      isCurrent: () => this.gesture === gesture,
      run: () => {
        gesture.range = this.options.word(gesture.position)
        this.lastTap = null
      },
    })
  }

  private move = (event: TouchEvent): void => {
    const gesture = this.gesture
    if (!gesture) return
    if (event.touches.length !== 1) {
      this.cancel()
      return
    }
    const finger = Array.from(event.touches).find(
      (touch) => touch.identifier === gesture.identifier,
    )
    if (!finger) return
    if (gesture.range) {
      const position = this.options.positionAt(finger.clientX, finger.clientY)
      if (!position) return
      event.preventDefault()
      this.options.extend(gesture.range, position)
      return
    }
    if (Math.hypot(finger.clientX - gesture.x, finger.clientY - gesture.y) <= MOVE_SLOP) return
    this.cancel()
  }

  private end = (event: TouchEvent): void => {
    const gesture = this.gesture
    this.clearHold()
    this.gesture = null
    if (!gesture || gesture.range) return
    if (event.touches.length > 0) {
      this.lastTap = null
      return
    }
    const now = event.timeStamp
    const previous = this.lastTap
    const doubleTap =
      previous &&
      now - previous.time <= TAP_DELAY &&
      Math.hypot(gesture.x - previous.x, gesture.y - previous.y) <= MOVE_SLOP
    if (doubleTap) {
      this.lastTap = null
      this.options.word(gesture.position)
      return
    }
    this.lastTap = { x: gesture.x, y: gesture.y, time: now }
    this.options.tap(gesture.position)
  }

  private cancel = (): void => {
    this.clearHold()
    this.gesture = null
    this.lastTap = null
  }

  private clearHold(): void {
    this.scheduler.cancel('touch-selection-hold')
  }
}
