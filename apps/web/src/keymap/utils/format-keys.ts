import { detectPlatform } from '@fregat/hotkeys'

import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'
import {
  CHORD_DISPLAY_SEPARATOR,
  chordStrokes,
  type PlatformName,
} from '@workspace/client-core/commands/chord'

export function commandShortcut(
  command: PlatformCommandId,
  bindings: readonly PlatformKeyBinding[],
) {
  const binding = bindings.find((candidate) => candidate.command === command)
  if (!binding) return null

  return formatChord(binding.keys)
}

export function formatChord(keys: string, platform: PlatformName = detectPlatform()): string {
  return chordStrokes(keys)
    .map((stroke) => formatHotkey(stroke, platform))
    .join(CHORD_DISPLAY_SEPARATOR)
}

function formatHotkey(hotkey: string, platform: PlatformName) {
  const isMac = platform === 'mac'
  const separator = isMac ? '' : '+'

  return hotkey
    .split('+')
    .map((token) => hotkeyTokenLabel(token, isMac))
    .join(separator)
}

export function hotkeyTokenLabel(token: string, isMac: boolean) {
  const normalized = token.toLowerCase()
  if (normalized === 'mod') return isMac ? '⌘' : 'Ctrl'
  if (normalized === 'meta') return isMac ? '⌘' : 'Meta'
  if (normalized === 'cmd') return isMac ? '⌘' : 'Cmd'
  if (normalized === 'ctrl' || normalized === 'control') return isMac ? '⌃' : 'Ctrl'
  if (normalized === 'shift') return isMac ? '⇧' : 'Shift'
  if (normalized === 'alt') return isMac ? '⌥' : 'Alt'
  if (normalized === 'enter') return '↵'
  if (normalized === 'escape') return 'Esc'
  if (normalized.length === 1) return normalized.toUpperCase()

  return token
}
