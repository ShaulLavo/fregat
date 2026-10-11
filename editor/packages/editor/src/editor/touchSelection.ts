import type { TextOffsetRange } from '../textRanges'
import type { VirtualizedTextHitPosition } from '../virtualization/virtualizedTextViewTypes'
import { EditorWorkScheduler } from './workScheduler'
import { scheduleFrame, type ScheduledFrame } from './scheduleFrame'
import { TouchSelectionMenu, type TouchMenuItem } from './touchSelectionMenu'

// A stationary hold selects; a swipe crossing the slop stays with the browser's scroll gesture.
const HOLD_DELAY = 550
const TAP_DELAY = 350
const MOVE_SLOP = 10
const FINGER_LIFT = 12

type TouchGesture = {
  readonly identifier: number
  readonly x: number
  readonly y: number
  readonly position: VirtualizedTextHitPosition
  currentX: number
  currentY: number
  dragging: boolean
  range: TextOffsetRange | null
}

type TouchSelectionOptions = {
  readonly element: HTMLElement
  positionAt(x: number, y: number): VirtualizedTextHitPosition | null
  claimPress(event: TouchEvent): boolean
  begin(): void
  tap(position: VirtualizedTextHitPosition): void
  word(position: VirtualizedTextHitPosition): TextOffsetRange
  extend(anchor: TextOffsetRange, position: VirtualizedTextHitPosition): void
  scroll(x: number, y: number): boolean
  focus(): void
  menuAnchor(): { readonly x: number; readonly y: number; readonly bottom: number } | null
  menuItems(): readonly TouchMenuItem[]
}

/** Touch recognizes gestures; selection, word boundaries, painting and scrolling belong to the editor. */
export class TouchSelectionController {
  private gesture: TouchGesture | null = null
  private readonly scheduler = new EditorWorkScheduler()
  private readonly menu: TouchSelectionMenu
  private lastTap: { readonly x: number; readonly y: number; readonly time: number } | null = null
  private pointerType = 'mouse'
  private pendingMousePress: boolean | null = null
  private scrollFrame: ScheduledFrame | null = null

  constructor(private readonly options: TouchSelectionOptions) {
    this.menu = new TouchSelectionMenu(options.element, options.menuItems)
  }

  get ownsMouseEvent(): boolean {
    return this.pointerType === 'touch'
  }

  consumeMousePress(): boolean | null {
    const claimed = this.pendingMousePress
    this.pendingMousePress = null
    return claimed
  }

  install(): void {
    const element = this.options.element
    element.ownerDocument.addEventListener('pointerdown', this.pointerDown, { capture: true })
    element.addEventListener('touchstart', this.start, { passive: false })
    element.addEventListener('touchmove', this.move, { passive: false })
    element.addEventListener('touchend', this.end, { passive: false })
    element.addEventListener('touchcancel', this.cancel)
    element.addEventListener('contextmenu', this.contextMenu)
    element.addEventListener('scroll', this.hideMenu)
    element.addEventListener('beforeinput', this.hideMenu)
  }

  dispose(): void {
    const element = this.options.element
    element.ownerDocument.removeEventListener('pointerdown', this.pointerDown, { capture: true })
    element.removeEventListener('touchstart', this.start)
    element.removeEventListener('touchmove', this.move)
    element.removeEventListener('touchend', this.end)
    element.removeEventListener('touchcancel', this.cancel)
    element.removeEventListener('contextmenu', this.contextMenu)
    element.removeEventListener('scroll', this.hideMenu)
    element.removeEventListener('beforeinput', this.hideMenu)
    this.cancel()
    this.menu.dispose()
    this.scheduler.dispose()
    this.pendingMousePress = null
  }

  private hideMenu = (): void => this.menu.hide()

  private contextMenu = (event: MouseEvent): void => {
    if (this.ownsMouseEvent) event.preventDefault()
  }

  private pointerDown = (event: PointerEvent): void => {
    this.pointerType = event.pointerType
    if (event.pointerType === 'touch') return
    this.pendingMousePress = null
  }

  private start = (event: TouchEvent): void => {
    this.pointerType = 'touch'
    this.stopGesture()
    this.menu.hide()
    this.pendingMousePress = null
    if (event.defaultPrevented || event.touches.length !== 1) {
      this.lastTap = null
      return
    }
    this.pendingMousePress = this.options.claimPress(event)
    if (this.pendingMousePress) {
      this.lastTap = null
      return
    }
    const finger = event.touches[0]
    if (!finger) return
    const position = this.options.positionAt(finger.clientX, finger.clientY)
    if (!position) return
    const gesture: TouchGesture = {
      identifier: finger.identifier,
      x: finger.clientX,
      y: finger.clientY,
      currentX: finger.clientX,
      currentY: finger.clientY,
      position,
      dragging: false,
      range: null,
    }
    this.gesture = gesture
    this.options.begin()
    const previous = this.lastTap
    if (
      previous &&
      event.timeStamp - previous.time <= TAP_DELAY &&
      Math.hypot(gesture.x - previous.x, gesture.y - previous.y) <= MOVE_SLOP
    ) {
      event.preventDefault()
      this.lastTap = null
      gesture.range = this.options.word(position)
      return
    }
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
    const moved = Math.hypot(finger.clientX - gesture.x, finger.clientY - gesture.y) > MOVE_SLOP
    if (!gesture.range) {
      if (moved) this.cancel()
      return
    }
    event.preventDefault()
    if (!moved && !gesture.dragging) return
    gesture.dragging = true
    gesture.currentX = finger.clientX
    gesture.currentY = finger.clientY
    this.extend(gesture)
    this.autoScroll()
  }

  private extend(gesture: TouchGesture): void {
    if (!gesture.range) return
    const position = this.options.positionAt(gesture.currentX, gesture.currentY - FINGER_LIFT)
    if (position) this.options.extend(gesture.range, position)
  }

  private autoScroll(): void {
    const gesture = this.gesture
    if (!gesture?.dragging) return
    if (!this.options.scroll(gesture.currentX, gesture.currentY - FINGER_LIFT)) return
    this.extend(gesture)
    if (this.scrollFrame) return
    this.scrollFrame = scheduleFrame(() => {
      this.scrollFrame = null
      this.autoScroll()
    })
  }

  private end = (event: TouchEvent): void => {
    const gesture = this.gesture
    this.stopGesture()
    if (!gesture) return
    if (event.touches.length > 0) {
      this.lastTap = null
      return
    }
    if (gesture.range) {
      event.preventDefault()
      this.options.focus()
      const anchor = this.options.menuAnchor()
      this.menu.show(anchor?.x ?? gesture.currentX, anchor?.y ?? gesture.currentY, anchor?.bottom)
      return
    }
    this.lastTap = { x: gesture.x, y: gesture.y, time: event.timeStamp }
    this.options.tap(gesture.position)
  }

  private cancel = (): void => {
    this.stopGesture()
    this.lastTap = null
    this.menu.hide()
  }

  private stopGesture(): void {
    this.scheduler.cancel('touch-selection-hold')
    this.scrollFrame?.cancel()
    this.scrollFrame = null
    this.gesture = null
  }
}
