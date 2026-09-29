import { useSelector } from '@tanstack/react-store'
import { getHotkeyRegistry } from '@fregat/hotkeys'
import type { HotkeyRegistrationView } from '@fregat/hotkeys'

export interface HotkeyRegistrationsResult {
  /** Single-stroke registrations (public view, no callbacks) */
  hotkeys: Array<HotkeyRegistrationView>
  /** Multi-stroke registrations */
  sequences: Array<HotkeyRegistrationView>
}

/**
 * Lists the document registry's registrations, for devtools, palettes and cheat sheets.
 *
 * @example
 * ```tsx
 * function ShortcutList() {
 *   const { hotkeys } = useHotkeyRegistrations()
 *   return hotkeys.map((registration) => <li key={registration.id}>{registration.hotkey}</li>)
 * }
 * ```
 */
export function useHotkeyRegistrations(): HotkeyRegistrationsResult {
  const registry = getHotkeyRegistry()
  const hotkeys = useSelector(registry.registrations, (state) =>
    Array.from(state.values()).filter((view) => view.strokes.length === 1),
  )
  const sequences = useSelector(registry.registrations, (state) =>
    Array.from(state.values()).filter((view) => view.strokes.length > 1),
  )
  return { hotkeys, sequences }
}
