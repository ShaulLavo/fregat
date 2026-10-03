import { nodeCommands } from '@/keymap/node-commands'
import { environmentCommands } from '@/keymap/environment-commands'
import type { Icon } from '@phosphor-icons/react'

import { editorCommands } from './editor-commands'
import type { PlatformCommandId } from './types'
import { workspaceCommands } from './workspace-commands'

export const platformCommands = [
  ...workspaceCommands,
  ...editorCommands,
  ...environmentCommands,
  ...nodeCommands,
]

/** One row from the sole live command table. */
export type CommandEntry = (typeof platformCommands)[number]

const byId = new Map<string, CommandEntry>(platformCommands.map((command) => [command.id, command]))

export function platformCommand(id: string): CommandEntry | null {
  return isPlatformCommandId(id) ? (byId.get(id) ?? null) : null
}

export function isPlatformCommandId(id: string): id is PlatformCommandId {
  return byId.has(id)
}

function iconsById(): Partial<Record<PlatformCommandId, Icon>> {
  const icons: Partial<Record<PlatformCommandId, Icon>> = {}

  for (const command of platformCommands) {
    if (!('icon' in command) || !command.icon) continue

    icons[command.id] = command.icon
  }

  return icons
}

/**
 * A record rather than a `commandIcon(id)` call, because the consumer uses the
 * result as a JSX element type: the React Compiler reads a call there as a
 * component built during render (`static-components`) and errors, while an index
 * into this module-level map is visibly static.
 */
export const commandIcons = iconsById()

function idsWhere(predicate: (command: CommandEntry) => boolean): ReadonlySet<PlatformCommandId> {
  const ids = new Set<PlatformCommandId>()

  for (const command of platformCommands) {
    if (!predicate(command)) continue

    ids.add(command.id)
  }

  return ids
}

// The three policy projections the palette re-exports. The names there stay as
// they were, because `view-groups.tsx` and `command-palette-utils.ts` import
// those exact ones.
export const paletteModeCommandIds = idsWhere((command) => command.keepsPaletteOpen === true)
export const hiddenPaletteCommandIds = idsWhere((command) => command.hiddenInPalette === true)
