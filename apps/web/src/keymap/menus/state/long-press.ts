/**
 * iOS Safari fires no `contextmenu` on a long press, so no surface's context menu opens there.
 * This dispatches one at the press point for every `onContextMenu` handler at once. It waits
 * past the 500ms Android Chrome and Base UI's own triggers use, and stands down for good once the
 * platform shows it fires its own. A Base UI trigger stops its touch from reaching `window`.
 */
const LONG_PRESS_MS = 550
const MOVE_TOLERANCE_PX = 10
/** How long after the press the lifted finger's click is swallowed. */
const CLICK_GUARD_MS = 800

type Press = {
  readonly target: EventTarget
  readonly x: number
  readonly y: number
  readonly timer: ReturnType<typeof setTimeout>
}

export function installLongPressContextMenu(target: Window = window) {
  let press: Press | null = null
  let dispatching = false
  let platformFires = false

  function cancel() {
    if (press) clearTimeout(press.timer)
    press = null
  }

  function fire() {
    const current = press
    press = null
    if (!current) return
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
    guardNextClick(target)
  }

  function onTouchStart(event: TouchEvent) {
    cancel()
    const touch = event.touches[0]
    if (platformFires || event.touches.length !== 1 || !touch || !event.target) return
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

  function onContextMenu() {
    if (dispatching || !press) return
    platformFires = true
    cancel()
  }

  const options = { capture: true, passive: true } as const
  target.addEventListener('touchstart', onTouchStart, { passive: true })
  target.addEventListener('touchmove', onTouchMove, options)
  target.addEventListener('touchend', cancel, options)
  target.addEventListener('touchcancel', cancel, options)
  target.addEventListener('scroll', cancel, options)
  target.addEventListener('contextmenu', onContextMenu, { capture: true })
  return () => {
    cancel()
    target.removeEventListener('touchstart', onTouchStart)
    target.removeEventListener('touchmove', onTouchMove, options)
    target.removeEventListener('touchend', cancel, options)
    target.removeEventListener('touchcancel', cancel, options)
    target.removeEventListener('scroll', cancel, options)
    target.removeEventListener('contextmenu', onContextMenu, { capture: true })
  }
}

/** The finger lifts after the menu opened; its click must not also press what it is on. */
function guardNextClick(target: Window) {
  const swallow = (event: Event) => {
    event.preventDefault()
    event.stopPropagation()
  }
  target.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => target.removeEventListener('click', swallow, { capture: true }), CLICK_GUARD_MS)
}
