import { createRecentCommandsLedger } from '@workspace/client-core/commands/recent-commands'
import { createSubscriptions } from '@workspace/utils/subscriptions'
import type { PlatformCommandId } from '@/keymap/types'
import { globalChromeStorage } from '@/lib/environments/state/scoped-storage'

const ledger = createRecentCommandsLedger({
  key: 'platform.command-palette.recent-commands.v1',
  limit: 30,
  format: 'versioned',
})
const storage = {
  getItem: globalChromeStorage.getItem,
  updateItem(key: string, transform: (current: string | null) => string | null) {
    const value = transform(globalChromeStorage.getItem(key))
    if (value === null) globalChromeStorage.removeItem(key)
    else globalChromeStorage.setItem(key, value)
  },
}

const subscriptions = createSubscriptions()
export const subscribeRecentCommands = subscriptions.subscribe

// Cached so repeat reads return the same reference: `useSyncExternalStore` treats
// a fresh array each call as a fresh value and re-renders forever.
let recentIds: readonly string[] | null = null

/** Command ids the user has run from the palette, most recent first. */
export function recentCommandIds(): readonly string[] {
  recentIds ??= ledger.read(storage)

  return recentIds
}

export function recordCommandUse(commandId: PlatformCommandId) {
  const current = recentCommandIds()
  if (current[0] === commandId) return

  recentIds = ledger.record(storage, commandId, current)
  subscriptions.notify()
}

/** Test hook: drops in-memory state so the next read hits localStorage again. */
export function resetRecentCommandsStore() {
  recentIds = null
  subscriptions.clear()
}
