import { detectPlatform } from '@tanstack/hotkeys'

/** Mod+. on the active problem: VS Code's quick-fix chord, here handing the problem to chat. */
export const FIX_SHORTCUT = detectPlatform() === 'mac' ? 'Meta+.' : 'Control+.'

export function isFixKey(event: Pick<KeyboardEvent, 'ctrlKey' | 'key' | 'metaKey'>) {
  if (event.key !== '.') return false
  return detectPlatform() === 'mac' ? event.metaKey : event.ctrlKey
}
