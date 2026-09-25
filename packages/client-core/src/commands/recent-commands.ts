import * as v from 'valibot'
import type { KeyValueStorage } from '../storage'

type ReadStorage = Pick<KeyValueStorage, 'getItem'> & {
  removeItemIfValue?: (key: string, value: string) => boolean
}
type WriteStorage = ReadStorage & {
  updateItem(key: string, transform: (current: string | null) => string | null): void
}
type RecentCommandsPolicy = {
  key: string
  limit: number
  format: 'array' | 'versioned'
  onDiscard?: () => void
}
const commandIdsSchema = v.array(v.string())
const envelopeSchema = v.object({ version: v.literal(1), commandIds: v.array(v.unknown()) })

export function createRecentCommandsLedger(policy: RecentCommandsPolicy) {
  function parse(raw: string | null): readonly string[] {
    if (raw === null) return []
    const value: unknown = JSON.parse(raw)
    if (policy.format === 'array') return v.parse(commandIdsSchema, value)
    return v
      .parse(envelopeSchema, value)
      .commandIds.filter((id): id is string => typeof id === 'string')
  }

  function readValue(storage: ReadStorage, raw: string | null): readonly string[] {
    let current = raw
    while (current !== null) {
      const result = parsedValue(storage, current)
      if (result !== null) return result
      current = storage.getItem(policy.key)
    }
    return []
  }

  function parsedValue(storage: ReadStorage, raw: string): readonly string[] | null {
    try {
      return parse(raw)
    } catch {
      if (!storage.removeItemIfValue) return []
      if (!storage.removeItemIfValue(policy.key, raw)) return null
      policy.onDiscard?.()
      return []
    }
  }

  return {
    parse,
    read: (storage: ReadStorage) => readValue(storage, storage.getItem(policy.key)),
    record(storage: WriteStorage, commandId: string): readonly string[] {
      let next: readonly string[] = []
      storage.updateItem(policy.key, (raw) => {
        const current = readValue(storage, raw)
        next = [commandId, ...current.filter((id) => id !== commandId)].slice(0, policy.limit)
        return JSON.stringify(policy.format === 'array' ? next : { commandIds: next, version: 1 })
      })
      return next
    },
  }
}
