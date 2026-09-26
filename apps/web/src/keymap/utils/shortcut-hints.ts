import {
  parseKeyStroke,
  type KeyStroke,
  type PlatformName,
} from '@workspace/client-core/commands/chord'

import type { HeldModifiers } from '@/keymap/utils/held-modifiers'
import { hotkeyTokenLabel } from '@/keymap/utils/format-keys'
import type { PlatformCommandId, PlatformKeyBinding } from '@/keymap/types'

/**
 * The key to show on a target while `held` exactly matches the modifiers of one of the
 * command's live single-stroke bindings. An unbound, shadowed or two-stroke command has none.
 */
export function shortcutHintLabel(
  bindings: readonly PlatformKeyBinding[],
  command: PlatformCommandId,
  held: HeldModifiers,
  platform: PlatformName,
): string | null {
  if (!held.alt && !held.ctrl && !held.meta && !held.shift) return null

  for (const stroke of singleStrokes(bindings, command, platform)) {
    if (!sameModifiers(stroke, held)) continue
    return hotkeyTokenLabel(stroke.key, platform === 'mac')
  }

  return null
}

/** The command's single-stroke shortcuts in `aria-keyshortcuts` syntax. */
export function ariaKeyShortcuts(
  bindings: readonly PlatformKeyBinding[],
  command: PlatformCommandId,
  platform: PlatformName,
): string | undefined {
  const shortcuts = singleStrokes(bindings, command, platform).map(ariaShortcut)
  return shortcuts.length > 0 ? shortcuts.join(' ') : undefined
}

function singleStrokes(
  bindings: readonly PlatformKeyBinding[],
  command: PlatformCommandId,
  platform: PlatformName,
): readonly KeyStroke[] {
  const strokes: KeyStroke[] = []
  for (const binding of bindings) {
    if (binding.command !== command || binding.chord.length !== 1) continue
    const stroke = parseKeyStroke(binding.keys, platform)
    if (stroke) strokes.push(stroke)
  }
  return strokes
}

function sameModifiers(stroke: KeyStroke, held: HeldModifiers) {
  return (
    stroke.alt === held.alt &&
    stroke.ctrl === held.ctrl &&
    stroke.meta === held.meta &&
    stroke.shift === held.shift
  )
}

function ariaShortcut(stroke: KeyStroke) {
  const parts: string[] = []
  if (stroke.ctrl) parts.push('Control')
  if (stroke.meta) parts.push('Meta')
  if (stroke.alt) parts.push('Alt')
  if (stroke.shift) parts.push('Shift')
  parts.push(stroke.key)
  return parts.join('+')
}
