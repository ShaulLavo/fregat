import type { TextOffsetRange } from '../textRanges'
import type { VirtualizedTextHitPosition } from '../virtualization/virtualizedTextViewTypes'
import { EditorWorkScheduler } from './workScheduler'
import { scheduleFrame, type ScheduledFrame } from './scheduleFrame'

// A stationary hold selects; a swipe crossing the slop stays with the browser's scroll gesture.
const HOLD_DELAY = 550
const TAP_DELAY = 350
const MOVE_SLOP = 10
const FINGER_LIFT = 12

export type TouchSelectionGranularity = 'word' | 'line' | 'document'
export type TouchSelectionPhase = 'start' | 'update' | 'end' | 'cancel'

type TouchGesture = {
  readonly tapCount: number
  readonly granularity: TouchSelectionGranularity
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
  select(
    position: VirtualizedTextHitPosition,
    granularity: TouchSelectionGranularity,
  ): TextOffsetRange
  extend(
    anchor: TextOffsetRange,
    position: VirtualizedTextHitPosition,
    granularity: TouchSelectionGranularity,
  ): void
  scroll(x: number, y: number): boolean
  focus(): void
  notify(
    phase: TouchSelectionPhase,
    kind: TouchSelectionGranularity | null,
    point?: { readonly x: number; readonly y: number; readonly bottom: number },
  ): void
}

/** Touch recognizes gestures; selection, word boundaries, painting and scrolling belong to the editor. */
export class TouchSelectionController {
  private gesture: TouchGesture | null = null
  private readonly scheduler = new EditorWorkScheduler()
  private lastTap: {
    readonly x: number
    readonly y: number
    readonly time: number
    readonly count: number
  } | null = null
  private pointerType = 'mouse'
  private pendingMousePress: boolean | null = null
  private scrollFrame: ScheduledFrame | null = null
  private endFrame: ScheduledFrame | null = null
  private selectionState: { session: object; snapshot: object; selections: object } | null = null

  constructor(private readonly options: TouchSelectionOptions) {}

  selectionChanged(session: object, snapshot: object, selections: object): void {
    const previous = this.selectionState
    this.selectionState = { session, snapshot, selections }
    if (
      previous?.session === session &&
      previous.snapshot === snapshot &&
      previous.selections === selections
    )
      return
    this.cancel()
  }

  acceptSelection(session: object, snapshot: object, selections: object): void {
    this.selectionState = { session, snapshot, selections }
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
    element.addEventListener('touchstart', this.start, { passive: false, capture: true })
    element.addEventListener('touchmove', this.move, { passive: false })
    element.addEventListener('touchend', this.end, { passive: false })
    element.addEventListener('touchcancel', this.cancel)
    element.addEventListener('contextmenu', this.contextMenu)
    element.addEventListener('selectstart', this.selectStart)
    element.addEventListener('scroll', this.scrollNotification)
    element.addEventListener('wheel', this.cancelNotification)
    element.addEventListener('beforeinput', this.cancelNotification)
  }

  dispose(): void {
    const element = this.options.element
    element.ownerDocument.removeEventListener('pointerdown', this.pointerDown, { capture: true })
    element.removeEventListener('touchstart', this.start, { capture: true })
    element.removeEventListener('touchmove', this.move)
    element.removeEventListener('touchend', this.end)
    element.removeEventListener('touchcancel', this.cancel)
    element.removeEventListener('contextmenu', this.contextMenu)
    element.removeEventListener('selectstart', this.selectStart)
    element.removeEventListener('scroll', this.scrollNotification)
    element.removeEventListener('wheel', this.cancelNotification)
    element.removeEventListener('beforeinput', this.cancelNotification)
    this.cancel()
    this.scheduler.dispose()
    this.pendingMousePress = null
  }

  private cancelNotification = (): void => {
    this.endFrame?.cancel()
    this.endFrame = null
    this.options.notify('cancel', null)
  }

  private scrollNotification = (): void => {
    if (!this.endFrame) this.options.notify('cancel', null)
  }

  // See browser-quirks.md#ios-native-long-press-selection for native selectstart cancellation.
  private selectStart = (event: Event): void => {
    const Element = this.options.element.ownerDocument.defaultView?.Element
    if (!this.ownsMouseEvent || !Element) return
    if (
      event
        .composedPath()
        .some(
          (node) => node instanceof Element && node.classList.contains('editor-virtualized-row'),
        )
    )
      event.preventDefault()
  }

  // See browser-quirks.md#ios-native-long-press-selection for native callout suppression.
  private contextMenu = (event: MouseEvent): void => {
    if (this.ownsMouseEvent) event.preventDefault()
  }

  private pointerDown = (event: PointerEvent): void => {
    this.pointerType = event.pointerType
    const Node = this.options.element.ownerDocument.defaultView?.Node
    if (
      event.pointerType !== 'touch' ||
      !Node ||
      !(event.target instanceof Node) ||
      !this.options.element.contains(event.target)
    )
      this.lastTap = null
    if (this.endFrame) this.cancelNotification()
    if (event.pointerType === 'touch') return
    this.pendingMousePress = null
  }

  private start = (event: TouchEvent): void => {
    // See browser-quirks.md#ios-native-long-press-selection for capture-time suppression.
    this.options.element.dataset.editorTouchSelecting = 'true'
    this.pointerType = 'touch'
    this.stopGesture()
    this.cancelNotification()
    this.pendingMousePress = null
    if (event.defaultPrevented || event.touches.length !== 1) {
      delete this.options.element.dataset.editorTouchSelecting
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
    const previous = this.lastTap
    const repeated =
      previous &&
      event.timeStamp - previous.time <= TAP_DELAY &&
      Math.hypot(finger.clientX - previous.x, finger.clientY - previous.y) <= MOVE_SLOP
    const tapCount = repeated ? Math.min(previous.count + 1, 4) : 1
    let granularity: TouchSelectionGranularity = 'word'
    if (tapCount === 3) granularity = 'line'
    if (tapCount >= 4) granularity = 'document'
    const gesture: TouchGesture = {
      tapCount,
      granularity,
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
    if (tapCount > 1) {
      event.preventDefault()
      gesture.range = this.options.select(position, granularity)
      if (this.gesture !== gesture) return
      this.options.notify('start', granularity)
      return
    }
    this.scheduler.schedule({
      key: 'touch-selection-hold',
      taskClass: 'input-critical',
      delayMs: HOLD_DELAY,
      isCurrent: () => this.gesture === gesture,
      run: () => {
        gesture.range = this.options.select(gesture.position, 'word')
        if (this.gesture !== gesture) return
        this.lastTap = null
        this.options.notify('start', 'word')
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
    if (this.gesture !== gesture || !gesture.range) return
    const position = this.options.positionAt(gesture.currentX, gesture.currentY - FINGER_LIFT)
    if (!position) return
    const range = gesture.range
    this.options.extend(range, position, gesture.granularity)
    if (this.gesture !== gesture) return
    this.options.notify('update', gesture.granularity)
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
    delete this.options.element.dataset.editorTouchSelecting
    if (!gesture) return
    if (event.touches.length > 0) {
      this.lastTap = null
      return
    }
    if (gesture.range) {
      this.lastTap = null
      if (!gesture.dragging && gesture.tapCount > 1)
        this.lastTap = {
          x: gesture.x,
          y: gesture.y,
          time: event.timeStamp,
          count: gesture.tapCount,
        }
      event.preventDefault()
      // See browser-quirks.md#touch-release-scroll-ordering for deferred gesture settlement.
      this.endFrame = scheduleFrame(() => {
        this.endFrame = null
        this.options.notify('end', gesture.granularity, {
          x: gesture.currentX,
          y: gesture.currentY,
          bottom: gesture.currentY + 16,
        })
      })
      this.options.focus()
      return
    }
    this.lastTap = { x: gesture.x, y: gesture.y, time: event.timeStamp, count: 1 }
    this.options.tap(gesture.position)
  }

  private cancel = (): void => {
    delete this.options.element.dataset.editorTouchSelecting
    this.stopGesture()
    this.lastTap = null
    this.cancelNotification()
  }

  private stopGesture(): void {
    this.scheduler.cancel('touch-selection-hold')
    this.scrollFrame?.cancel()
    this.scrollFrame = null
    this.gesture = null
  }
}
