import {
  detectPlatform,
  normalizeRegisterableHotkey,
  parseHotkey,
  validateHotkey,
  type ParsedHotkey,
  type RawHotkey,
} from '@tanstack/hotkeys'
import { MAX_KEYBINDING_CHORD_STROKES } from '@workspace/contracts'

import type { KeyChord } from '@singapore-editor/core/keymap'

export type PlatformName = ReturnType<typeof detectPlatform>

/** A stroke bound by the character it types. Physical `[Code]` strokes are not bindable. */
export type KeyStroke = Extract<ParsedHotkey, { code?: never }>

export const MAX_CHORD_STROKES = MAX_KEYBINDING_CHORD_STROKES
export const CHORD_TIMEOUT_MS = 5_000
export const CHORD_DISPLAY_SEPARATOR = '\u2009'

export function chordStrokes(keys: string): readonly string[] {
  return keys.split(' ')
}

export function chordKeys(chord: KeyChord, platform: PlatformName): string {
  return chord.map((stroke) => normalizeRegisterableHotkey(stroke, platform)).join(' ')
}

export function isBindableChord(keys: string): boolean {
  const strokes = chordStrokes(keys)
  if (strokes.length > MAX_CHORD_STROKES) return false
  if (!strokes.every(isBindableStroke)) return false
  if (strokes.length === 1) return true

  const first = parseHotkey(strokes[0], 'mac')
  return first.ctrl || first.meta
}

/** Call only after validating external keys with isBindableChord. */
export function parsedChord(keys: string, platform: PlatformName): KeyChord {
  const [first, ...rest] = keys.split(' ')
  return [rawStroke(first, platform), ...rest.map((stroke) => rawStroke(stroke, platform))]
}

export function normalizedChord(keys: string, platform: PlatformName = detectPlatform()): string {
  return chordKeys(parsedChord(keys, platform), platform)
}

export function keysConflict(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < b.length) return b.startsWith(a) && b[a.length] === ' '

  return a.startsWith(b) && a[b.length] === ' '
}

export function isChordPrefix(keys: string, table: readonly { readonly keys: string }[]): boolean {
  return table.some(
    (binding) => binding.keys.length > keys.length && keysConflict(keys, binding.keys),
  )
}

/** Null for a physical `[Code]` stroke, which `isBindableChord` rejects. */
export function parseKeyStroke(stroke: string, platform: PlatformName): KeyStroke | null {
  const parsed = parseHotkey(stroke, platform)
  return parsed.code === undefined ? parsed : null
}

function isBindableStroke(stroke: string): boolean {
  if (!stroke || /\s/u.test(stroke)) return false
  if (!parseKeyStroke(stroke, 'mac')) return false
  const result = validateHotkey(stroke)
  // Unknown keys are only warnings in the library, but no keyboard can produce them.
  return result.valid && result.warnings.length === 0
}

function rawStroke(keys: string, platform: PlatformName): RawHotkey {
  const parsed = parseHotkey(keys, platform)
  const modifiers = { alt: parsed.alt, ctrl: parsed.ctrl, meta: parsed.meta, shift: parsed.shift }
  if (parsed.code !== undefined) return { ...modifiers, code: parsed.code }
  return { ...modifiers, key: parsed.key }
}
