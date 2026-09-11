import { recordObservabilityWarning } from '@workspace/observability'
import * as v from 'valibot'
import type { FileStorage } from '@/storage/files'

const recentCommandsSchema = v.array(v.string())
export const RECENT_COMMANDS = 'recent-commands'

export function parseRecentCommands(raw: string | null): readonly string[] {
  if (raw === null) return []
  return v.parse(recentCommandsSchema, JSON.parse(raw))
}

export function readRecentCommands(
  storage: Pick<FileStorage, 'getItem' | 'removeItemIfValue'>,
): readonly string[] {
  return readCommands(storage, storage.getItem(RECENT_COMMANDS))
}

export function recordRecentCommand(
  storage: Pick<FileStorage, 'getItem' | 'updateItem' | 'removeItemIfValue'>,
  commandId: string,
) {
  storage.updateItem(RECENT_COMMANDS, (current) => {
    const recent = readCommands(storage, current).filter((id) => id !== commandId)
    return JSON.stringify([commandId, ...recent].slice(0, 50))
  })
}

function readCommands(
  storage: Pick<FileStorage, 'getItem' | 'removeItemIfValue'>,
  raw: string | null,
): readonly string[] {
  let current = raw
  while (current !== null) {
    const commands = readCommandsValue(storage, current)
    if (commands !== null) return commands
    current = storage.getItem(RECENT_COMMANDS)
  }
  return []
}

function readCommandsValue(storage: Pick<FileStorage, 'removeItemIfValue'>, raw: string) {
  try {
    return parseRecentCommands(raw)
  } catch {
    if (!storage.removeItemIfValue(RECENT_COMMANDS, raw)) return null
    recordObservabilityWarning('tui.storage.read', {
      area: 'storage',
      storageKey: RECENT_COMMANDS,
      outcome: 'discarded',
    })
    return []
  }
}
