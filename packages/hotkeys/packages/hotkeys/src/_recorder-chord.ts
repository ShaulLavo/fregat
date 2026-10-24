import { normalizeKeyName } from './constants'
import { keyInputFromKeyboardEvent } from './adapters/browser'
import { isModifierKey, normalizeHotkeyFromParsed, parseKeyInput } from './parse'
import type { RecorderKeyMode, RecorderOptions, RecorderRejection } from './recorder-options'
import type { Hotkey } from './hotkey.types'

/**
 * Converts a keydown to a replayable chord, preserving physical codes by default.
 * Returns null for composition, modifier-only input, or unusable physical input.
 * Key mode retains the produced character; neither mode guesses layout letters.
 */
export function hotkeyChordFromKeydown(
  event: KeyboardEvent,
  platform: 'mac' | 'windows' | 'linux',
  recordBy: RecorderKeyMode = 'code',
): Hotkey | null {
  const input = keyInputFromKeyboardEvent(event, platform)
  if (input.composing || isModifierKey(normalizeKeyName(event.key)) || event.key === 'AltGraph')
    return null
  if (
    recordBy === 'code' &&
    (!/^[A-Za-z][A-Za-z0-9]*$/.test(event.code) ||
      event.code === 'Unidentified' ||
      input.modifiers.altGraph)
  )
    return null
  const parsed = parseKeyInput(input)
  if (recordBy === 'code') {
    // Remove logical identity rather than placing a physical code in the key field.
    const { key: _key, code: _code, ...modifiers } = parsed
    return normalizeHotkeyFromParsed({ ...modifiers, code: event.code }, platform)
  }
  return parsed.key ? normalizeHotkeyFromParsed(parsed, platform) : null
}

/**
 * Explains why a physical chord cannot be recorded before syntax/policy checks.
 * Logical mode deliberately accepts produced characters instead of requiring a code.
 */
export function chordRejection(
  event: KeyboardEvent,
  options: RecorderOptions,
): RecorderRejection | undefined {
  if (options.recordBy === 'key') return undefined
  // AltGr is character entry, often reported as synthetic Ctrl+Alt; macOS Option is handled separately.
  if (keyInputFromKeyboardEvent(event, options.platform).modifiers.altGraph)
    return {
      reason: 'alt-graph',
      message:
        'AltGraph character entry cannot be recorded as a physical shortcut. Use key mode for characters.',
    }
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(event.code) || event.code === 'Unidentified')
    return {
      reason: 'missing-code',
      message: 'This event has no usable physical key code.',
    }
  return undefined
}
