import { createKeyInput } from '../key-input'
import type { KeyInput } from '../key-input'
import type { KeyEffects } from '../chords/runtime'

/**
 * A key parsed from terminal input (legacy escapes or the Kitty protocol), in the shape
 * OpenTUI's `KeyEvent` has. Terminals report Alt as `meta` or `option` and Super as `super`.
 */
export type TerminalKeyLike = {
  readonly name: string
  readonly ctrl: boolean
  readonly shift: boolean
  readonly meta: boolean
  readonly option?: boolean
  readonly super?: boolean
  readonly eventType?: 'press' | 'repeat' | 'release'
  readonly repeated?: boolean
  readonly preventDefault?: () => void
  readonly stopPropagation?: () => void
}

const TERMINAL_KEY_NAMES: Readonly<Record<string, string>> = {
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  return: 'Enter',
  enter: 'Enter',
  linefeed: 'Enter',
  escape: 'Escape',
  esc: 'Escape',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  tab: 'Tab',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  space: 'Space',
}

/** Converts a parsed terminal key into a {@link KeyInput}. Terminals report no physical code. */
export function keyInputFromTerminalKey(event: TerminalKeyLike): KeyInput {
  const key = TERMINAL_KEY_NAMES[event.name] ?? event.name
  const alt = event.meta || event.option === true
  const superKey = event.super === true
  // A printed symbol already carries its Shift (`?`), which a Kitty report still flags.
  const printedSymbol =
    key.length === 1 && !/[\p{L}\p{N}]/u.test(key) && !event.ctrl && !alt && !superKey
  return createKeyInput({
    type: event.eventType === 'release' ? 'keyup' : 'keydown',
    key,
    modifiers: { ctrl: event.ctrl, shift: event.shift && !printedSymbol, alt, meta: superKey },
    repeat: event.eventType === 'repeat' || event.repeated === true,
  })
}

/** Applies runtime decisions to a terminal key event; the terminal has no bubbling to stop. */
export const terminalKeyEffects: KeyEffects<TerminalKeyLike> = {
  preventDefault: (event) => event.preventDefault?.(),
  stopPropagation: (event) => event.stopPropagation?.(),
  swallow: (event) => {
    event.preventDefault?.()
    event.stopPropagation?.()
  },
}
