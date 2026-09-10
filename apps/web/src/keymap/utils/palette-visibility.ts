import type { PlatformCommandBus } from '@/keymap/providers/command-context'
import { platformCommand } from '@/keymap/table'
import type { PlatformCommandId } from '@/keymap/types'
import type { FocusTargetSnapshot } from '@/lib/focus/state/service'

export function isCommandVisibleInPalette(
  command: PlatformCommandId,
  inspection: ReturnType<PlatformCommandBus['inspect']>,
  origin: FocusTargetSnapshot | null,
): boolean {
  const entry = platformCommand(command)
  if (!entry || entry.hiddenInPalette) return false

  if (entry.target === 'editor') {
    if (origin && !origin.capabilities.editor) return false
    return inspection.target?.kind === 'editor'
  }

  const snapshot = inspection.snapshot
  if (!snapshot) return true
  if (entry.when.includes('workspaceOpen') && !snapshot.workspaceOpen) return false
  if (entry.when.includes('chatMode') && !snapshot.chatMode) return false

  return true
}
