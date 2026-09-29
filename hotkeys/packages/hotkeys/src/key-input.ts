import { normalizeKeyName } from './constants'

/** Modifier state of one key press. `altGraph` marks Control+Alt synthesized by AltGr. */
export interface KeyModifiers {
  ctrl: boolean
  shift: boolean
  alt: boolean
  meta: boolean
  altGraph: boolean
}

/**
 * A key press from any host, independent of the DOM. `key` is the normalized key name
 * (`'Escape'`, `'S'`, `'?'`); `code` is the physical key (`'KeyS'`) or `''` when the host has none.
 */
export interface KeyInput {
  type: 'keydown' | 'keyup'
  key: string
  code: string
  modifiers: KeyModifiers
  repeat: boolean
  composing: boolean
}

export interface KeyInputInit {
  type?: 'keydown' | 'keyup'
  key: string
  code?: string
  modifiers?: Partial<KeyModifiers>
  repeat?: boolean
  composing?: boolean
}

/** Builds a {@link KeyInput}, normalizing the key name and filling defaults. */
export function createKeyInput(init: KeyInputInit): KeyInput {
  const raw = init.key.normalize('NFC')
  const modifiers = init.modifiers ?? {}
  return {
    type: init.type ?? 'keydown',
    key: normalizeKeyName(raw),
    code: init.code ?? '',
    modifiers: {
      ctrl: modifiers.ctrl ?? false,
      shift: modifiers.shift ?? false,
      alt: modifiers.alt ?? false,
      meta: modifiers.meta ?? false,
      altGraph: modifiers.altGraph ?? false,
    },
    repeat: init.repeat ?? false,
    // IMEs report the key being composed as Process or Unidentified.
    composing: (init.composing ?? false) || raw === 'Process' || raw === 'Unidentified',
  }
}
