import { chatCommandMetadata } from './chat'
import { settingsCommandMetadata } from './settings'
import { editorCommandMetadata } from './editor'
import { environmentCommandMetadata } from './environment'
import { foundationCommandMetadata } from './foundation'
import { workbenchCommandMetadata } from './workbench'
import { ITEM_POSITIONS } from './item-position'
import { selectItemMetadata, sidebarPanelMetadata, workspaceCommandMetadata } from './workspace'
import type { CommandMetadata } from './metadata'

export const commandMetadata = [
  ...Object.values(workspaceCommandMetadata),
  ...Object.values(editorCommandMetadata),
  ...Object.values(environmentCommandMetadata),
  ...ITEM_POSITIONS.map(selectItemMetadata),
  ...ITEM_POSITIONS.map(sidebarPanelMetadata),
  ...Object.values(foundationCommandMetadata),
  ...Object.values(settingsCommandMetadata),
  ...Object.values(workbenchCommandMetadata),
  ...Object.values(chatCommandMetadata),
]

export type CommandId = (typeof commandMetadata)[number]['id']
const byId: ReadonlyMap<string, CommandMetadata<CommandId>> = new Map(
  commandMetadata.map((command) => [command.id, command]),
)

export function commandById(id: string): CommandMetadata<CommandId> | null {
  return byId.get(id) ?? null
}

export function isCommandId(id: string): id is CommandId {
  return byId.has(id)
}
