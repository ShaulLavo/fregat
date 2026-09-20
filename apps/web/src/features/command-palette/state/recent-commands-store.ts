import { createSubscriptions } from '@workspace/utils/subscriptions'
import type { PlatformCommandId } from '@/keymap/types'
import { globalChromeStorage } from '@/lib/environments/state/scoped-storage'

const RECENT_COMMANDS_STORAGE_KEY = 'platform.command-palette.recent-commands.v1'
const RECENT_COMMANDS_STORAGE_VERSION = 1
/**
 * How much history to keep. Only the first few are ever shown, but the tail is
 * what makes an occasionally-used command outrank a never-used one once the
 * query narrows the list.
 */
const RECENT_COMMANDS_LIMIT = 30

const subscriptions = createSubscriptions()
export const subscribeRecentCommands = subscriptions.subscribe

// Cached so repeat reads return the same reference: `useSyncExternalStore` treats
// a fresh array each call as a fresh value and re-renders forever.
let recentIds: readonly PlatformCommandId[] | null = null

/** Command ids the user has run from the palette, most recent first. */
export function recentCommandIds(): readonly PlatformCommandId[] {
  recentIds ??= readPersistedRecentCommandIds()

  return recentIds
}

export function recordCommandUse(commandId: PlatformCommandId) {
  const current = recentCommandIds()
  if (current[0] === commandId) return

  recentIds = [commandId, ...current.filter((id) => id !== commandId)].slice(
    0,
    RECENT_COMMANDS_LIMIT,
  )
  persistRecentCommandIds(recentIds)
  subscriptions.notify()
}

/** Test hook: drops in-memory state so the next read hits localStorage again. */
export function resetRecentCommandsStore() {
  recentIds = null
  subscriptions.clear()
}

function readPersistedRecentCommandIds(): readonly PlatformCommandId[] {
  try {
    const raw = globalChromeStorage.getItem(RECENT_COMMANDS_STORAGE_KEY)
    if (!raw) return []

    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return []
    if ((parsed as { version?: unknown }).version !== RECENT_COMMANDS_STORAGE_VERSION) return []

    const commandIds = (parsed as { commandIds?: unknown }).commandIds
    if (!Array.isArray(commandIds)) return []

    return commandIds.filter((id): id is PlatformCommandId => typeof id === 'string')
  } catch {
    return []
  }
}

function persistRecentCommandIds(commandIds: readonly PlatformCommandId[]) {
  globalChromeStorage.setItem(
    RECENT_COMMANDS_STORAGE_KEY,
    JSON.stringify({ commandIds, version: RECENT_COMMANDS_STORAGE_VERSION }),
  )
}
