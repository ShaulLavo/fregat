export type HeldModifiers = {
  readonly alt: boolean
  readonly ctrl: boolean
  readonly meta: boolean
  readonly shift: boolean
}

export const NO_HELD_MODIFIERS: HeldModifiers = {
  alt: false,
  ctrl: false,
  meta: false,
  shift: false,
}

type ModifierEvent = Pick<
  KeyboardEvent,
  'altKey' | 'ctrlKey' | 'key' | 'metaKey' | 'shiftKey' | 'type'
>

function sameHeldModifiers(left: HeldModifiers, right: HeldModifiers) {
  return (
    left.alt === right.alt &&
    left.ctrl === right.ctrl &&
    left.meta === right.meta &&
    left.shift === right.shift
  )
}

/**
 * Only a modifier's own keydown sets its bit. A non-modifier key may clear a bit but never
 * set one: after a synthetic Cmd+V the browser can keep reporting `metaKey` on real keys,
 * which would pin hints on screen until the user taps Cmd.
 */
export function heldModifiersAfter(current: HeldModifiers, event: ModifierEvent): HeldModifiers {
  // Windows sends AltGr as Control then AltGraph; that Ctrl+Alt is typing, never a shortcut.
  if (event.key === 'AltGraph') return NO_HELD_MODIFIERS
  const modifier = modifierForKey(event.key)
  const next = modifier
    ? { ...current, [modifier]: event.type === 'keydown' }
    : {
        alt: current.alt && event.altKey,
        ctrl: current.ctrl && event.ctrlKey,
        meta: current.meta && event.metaKey,
        shift: current.shift && event.shiftKey,
      }

  return sameHeldModifiers(current, next) ? current : next
}

function modifierForKey(key: string): keyof HeldModifiers | null {
  if (key === 'Alt') return 'alt'
  if (key === 'Control') return 'ctrl'
  if (key === 'Meta' || key === 'OS') return 'meta'
  if (key === 'Shift') return 'shift'

  return null
}
