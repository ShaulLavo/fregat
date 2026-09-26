import { activeBindings } from '@workspace/client-core/commands/bindings'
import type { PlatformKeyBinding } from '@/keymap/types'
import type { FocusArea } from '@/lib/focus/state/service'

export function appKeyBindingsForPane(
  bindings: readonly PlatformKeyBinding[],
  focusedPane: FocusArea,
): readonly PlatformKeyBinding[] {
  return activeBindings(bindings, focusedPane)
}
