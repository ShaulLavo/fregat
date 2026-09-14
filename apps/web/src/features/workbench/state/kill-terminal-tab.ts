import { killTerminalSession } from '@/features/terminal/state/kill-session'
import {
  disposeTerminalSession,
  terminalSessionKey,
} from '@/features/terminal/state/session-registry'
import type { Client } from '@/lib/client'
import {
  closeTerminalTabInWorkbenchPanels,
  type WorkbenchPanels,
} from '@/features/workbench/utils/panels'

// Kills before the close: a mounted panel's socket carries the dispose, else the server route does.
export function killTerminalTab(
  panels: WorkbenchPanels,
  server: { client: Client; origin: string },
  rootPath: string,
  tabId: string,
) {
  if (!disposeTerminalSession(terminalSessionKey(rootPath, tabId)))
    killTerminalSession({ origin: server.origin, rootPath, terminalId: tabId })

  return closeTerminalTabInWorkbenchPanels(panels, tabId)
}
