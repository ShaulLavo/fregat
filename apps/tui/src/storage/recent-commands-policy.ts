import { createRecentCommandsLedger } from '@workspace/client-core/commands/recent-commands'
import { recordObservabilityWarning } from '@workspace/observability'

export const RECENT_COMMANDS = 'recent-commands'
export const recentCommands = createRecentCommandsLedger({
  key: RECENT_COMMANDS,
  limit: 50,
  format: 'array',
  onDiscard: () =>
    recordObservabilityWarning('tui.storage.read', {
      area: 'storage',
      storageKey: RECENT_COMMANDS,
      outcome: 'discarded',
    }),
})
