import {
  heldModifiersAfter,
  NO_HELD_MODIFIERS,
  type HeldModifiers,
} from '@/keymap/utils/held-modifiers'

let held: HeldModifiers = NO_HELD_MODIFIERS
const listeners = new Set<() => void>()

/** The modifiers physically down right now. Observed passively; no event is consumed. */
export function heldModifiers() {
  return held
}

export function subscribeHeldModifiers(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) attach()

  return () => {
    listeners.delete(listener)
    if (listeners.size > 0) return
    detach()
    held = NO_HELD_MODIFIERS
  }
}

function publish(next: HeldModifiers) {
  if (next === held) return
  held = next
  for (const listener of listeners) listener()
}

function onKey(event: KeyboardEvent) {
  publish(heldModifiersAfter(held, event))
}

// A paste can come from a dictation tool whose synthetic Cmd keyup never arrives.
function reset() {
  publish(NO_HELD_MODIFIERS)
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') reset()
}

function attach() {
  window.addEventListener('keydown', onKey, true)
  window.addEventListener('keyup', onKey, true)
  window.addEventListener('paste', reset, true)
  window.addEventListener('blur', reset)
  document.addEventListener('visibilitychange', onVisibilityChange)
}

function detach() {
  window.removeEventListener('keydown', onKey, true)
  window.removeEventListener('keyup', onKey, true)
  window.removeEventListener('paste', reset, true)
  window.removeEventListener('blur', reset)
  document.removeEventListener('visibilitychange', onVisibilityChange)
}
