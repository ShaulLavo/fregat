import { createKeyInput } from '../key-input'
import { normalizeHotkeyFromKeyInput, parseKeyInput } from '../parse'
import { detectPlatform } from '../platform'
import type { Hotkey, ParsedHotkey } from '../hotkey.types'
import type { KeyInput } from '../key-input'

/** The fields of a DOM `KeyboardEvent` the adapter reads; structural so the core needs no DOM types. */
export interface KeyboardEventLike {
  type: string
  key: string
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
  repeat?: boolean
  isComposing?: boolean
  /** 229 marks a key the IME is processing in browsers that leave `isComposing` false. */
  keyCode?: number
  getModifierState?: (modifier: string) => boolean
}

/** Converts a browser keyboard event into a {@link KeyInput}. */
export function keyInputFromKeyboardEvent(
  event: KeyboardEventLike,
  platform?: 'mac' | 'windows' | 'linux',
): KeyInput {
  return createKeyInput({
    type: event.type === 'keyup' ? 'keyup' : 'keydown',
    key: event.key || '',
    code: event.code || '',
    modifiers: {
      ctrl: Boolean(event.ctrlKey),
      shift: Boolean(event.shiftKey),
      alt: Boolean(event.altKey),
      meta: Boolean(event.metaKey),
      altGraph: readAltGraph(event, platform),
    },
    repeat: Boolean(event.repeat),
    composing: Boolean(event.isComposing) || event.keyCode === 229,
  })
}

function readAltGraph(event: KeyboardEventLike, platform?: 'mac' | 'windows' | 'linux'): boolean {
  // WebKit reports AltGraph for Option on some macOS layouts, where Option stays a shortcut modifier.
  if (platform === 'mac' || typeof event.getModifierState !== 'function') return false
  try {
    return event.getModifierState('AltGraph')
  } catch {
    // Synthetic events and older browsers may not implement this reliably.
    return false
  }
}

/**
 * Parses a keyboard event into a ParsedHotkey.
 *
 * @example
 * ```ts
 * document.addEventListener('keydown', (event) => {
 *   const parsed = parseKeyboardEvent(event)
 *   console.log(parsed) // { key: 'S', ctrl: true, shift: false, ... }
 * })
 * ```
 */
export function parseKeyboardEvent(
  event: KeyboardEventLike,
  platform?: 'mac' | 'windows' | 'linux',
): ParsedHotkey {
  return parseKeyInput(keyInputFromKeyboardEvent(event, platform))
}

/** Normalizes a keyboard event to the same canonical hotkey string as `normalizeHotkey`. */
export function normalizeHotkeyFromEvent(
  event: KeyboardEventLike,
  platform: 'mac' | 'windows' | 'linux' = detectPlatform(),
): Hotkey {
  return normalizeHotkeyFromKeyInput(keyInputFromKeyboardEvent(event, platform), platform)
}
