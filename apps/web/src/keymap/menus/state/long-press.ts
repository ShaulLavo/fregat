// iOS fires no `contextmenu` on a long press; this dispatches one for every surface's handler.
// Native text selection wins on selectable text; native menus cancel only their own press.
const LONG_PRESS_MS = 550
const MOVE_TOLERANCE_PX = 10
/** A native `contextmenu` this soon after a finger lifts still belongs to that press. */
const NATIVE_AFTER_LIFT_MS = 700

type Press = {
  readonly target: EventTarget
  readonly x: number
  readonly y: number
  readonly timer: ReturnType<typeof setTimeout>
}

export function installLongPressContextMenu(target: Window = window) {
  const document = target.document
  let press: Press | null = null
  /** This touch opened a menu: its lift must not also press what is under the finger. */
  let fired = false
  let touching = false
  let liftedAt = Number.NEGATIVE_INFINITY
  /** The last lifted press opened a menu; a native one right after it is the same request. */
  let liftedAfterFire = false
  let dispatching = false

  function cancel() {
    if (press) clearTimeout(press.timer)
    press = null
  }

  function fire() {
    const current = press
    press = null
    if (!current || !(target.getSelection()?.isCollapsed ?? true)) return
    fired = true
    dispatching = true
    current.target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: current.x,
        clientY: current.y,
      }),
    )
    dispatching = false
  }

  function onTouchStart(event: TouchEvent) {
    cancel()
    fired = false
    liftedAfterFire = false
    touching = true
    const touch = event.touches[0]
    if (event.touches.length !== 1 || !touch || !event.target) return
    if (startsOnSelectableText(document, event.target, touch.clientX, touch.clientY)) return
    press = {
      target: event.target,
      x: touch.clientX,
      y: touch.clientY,
      timer: setTimeout(fire, LONG_PRESS_MS),
    }
  }

  function onTouchMove(event: TouchEvent) {
    const touch = event.touches[0]
    if (!press || !touch) return
    const moved = Math.hypot(touch.clientX - press.x, touch.clientY - press.y)
    if (moved > MOVE_TOLERANCE_PX) cancel()
  }

  // Cancelling the lift is what stops the compatibility mouse events and the click, however long
  // the finger was held.
  function onTouchEnd(event: TouchEvent) {
    touching = false
    liftedAt = performance.now()
    cancel()
    liftedAfterFire = fired
    if (!fired) return
    fired = false
    if (event.cancelable) event.preventDefault()
  }

  function onTouchCancel() {
    touching = false
    fired = false
    cancel()
  }

  function onContextMenu(event: MouseEvent) {
    if (dispatching) return
    if (!touching && performance.now() - liftedAt > NATIVE_AFTER_LIFT_MS) return
    const pending = press !== null
    cancel()
    if (!fired && !(liftedAfterFire && !touching)) {
      fired = touching && pending
      return
    }
    // This press already opened the menu; the native event would open it a second time.
    event.preventDefault()
    event.stopPropagation()
  }

  function onSelectionChange() {
    if (!(target.getSelection()?.isCollapsed ?? true)) cancel()
  }

  const passive = { capture: true, passive: true } as const
  const active = { capture: true, passive: false } as const
  target.addEventListener('touchstart', onTouchStart, passive)
  target.addEventListener('touchmove', onTouchMove, passive)
  target.addEventListener('touchend', onTouchEnd, active)
  target.addEventListener('touchcancel', onTouchCancel, passive)
  target.addEventListener('scroll', cancel, passive)
  target.addEventListener('contextmenu', onContextMenu, { capture: true })
  document.addEventListener('selectionchange', onSelectionChange)
  return () => {
    cancel()
    target.removeEventListener('touchstart', onTouchStart, passive)
    target.removeEventListener('touchmove', onTouchMove, passive)
    target.removeEventListener('touchend', onTouchEnd, active)
    target.removeEventListener('touchcancel', onTouchCancel, passive)
    target.removeEventListener('scroll', cancel, passive)
    target.removeEventListener('contextmenu', onContextMenu, { capture: true })
    document.removeEventListener('selectionchange', onSelectionChange)
  }
}

/** Selectable text under the finger: a long press there is the platform's text selection. */
function startsOnSelectableText(document: Document, target: EventTarget, x: number, y: number) {
  if (!(target instanceof Element)) return false
  const view = document.defaultView
  if (!view) return false
  // WebKit reports `auto` on descendants of a select-none row. Resolve its used value
  // through ancestors, stopping at an explicit text override such as a rename field.
  for (let element: Element | null = target; element; element = element.parentElement) {
    const selection = view.getComputedStyle(element).userSelect
    if (selection === 'none') return false
    if (selection === 'text' || selection === 'all') break
  }
  const range = document.caretRangeFromPoint?.(x, y)
  return range?.startContainer.nodeType === Node.TEXT_NODE
}
