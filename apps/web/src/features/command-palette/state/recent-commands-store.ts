import { createRecentCommandsLedger } from '@workspace/client-core/commands/recent-commands'
import { createStore } from 'zustand/vanilla'
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

/** Command ids the user has run from the palette, most recent first. */
export const recentCommandsStore = createStore<readonly string[]>(() => ledger.read(storage))

export function recentCommandIds(): readonly string[] {
  return recentCommandsStore.getState()
}

export function recordCommandUse(commandId: PlatformCommandId) {
  const current = recentCommandsStore.getState()
  if (current[0] === commandId) return

  recentCommandsStore.setState(ledger.record(storage, commandId, current), true)
}

/** Test hook: the next state is what a fresh page load would read from localStorage. */
export function resetRecentCommandsStore() {
  recentCommandsStore.setState(ledger.read(storage), true)
}
