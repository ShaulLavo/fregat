import { afterEach, expect, it } from 'vitest'
import * as v from 'valibot'
import { beginReloadBudget, finishReloadBudget, RELOAD_MAX_BYTES } from '@/lib/reload-budget'
import { readWorkspaceCacheEntry } from '@/lib/workspace-cache-storage'
import type { StorageAccess } from '@/lib/environments/state/scoped-storage'

const schema = v.object({ text: v.string() })
afterEach(() => {
  finishReloadBudget()
})

it('caps aggregate parsed bytes and leaves deferred records intact', () => {
  const records = new Map([
    ['first', JSON.stringify({ text: 'a'.repeat(RELOAD_MAX_BYTES / 3) })],
    ['second', JSON.stringify({ text: 'b'.repeat(RELOAD_MAX_BYTES / 3) })],
  ])
  const storage = access(records)
  beginReloadBudget()
  expect(readWorkspaceCacheEntry('first', schema, null, { storage })).not.toBeNull()
  expect(readWorkspaceCacheEntry('second', schema, null, { storage })).toBeNull()
  expect(records.has('second')).toBe(true)
  const metrics = finishReloadBudget()
  expect(metrics?.parsedBytes).toBeLessThanOrEqual(RELOAD_MAX_BYTES)
  expect(metrics?.refused).toBe(1)
  expect(readWorkspaceCacheEntry('second', schema, null, { storage })).not.toBeNull()
})

it('validates repeated identical records once during boot and expires reuse at handoff', () => {
  const records = new Map([['view', JSON.stringify({ text: 'saved' })]])
  const storage = access(records)
  beginReloadBudget()
  const first = readWorkspaceCacheEntry('view', schema, null, { storage })
  expect(readWorkspaceCacheEntry('view', schema, null, { storage })).toBe(first)
  expect(finishReloadBudget()).toMatchObject({ records: 1, reused: 1, refused: 0 })
  expect(readWorkspaceCacheEntry('view', schema, null, { storage })).not.toBe(first)
})

function access(records: Map<string, string>): StorageAccess {
  return {
    getItem: (key) => records.get(key) ?? null,
    setItem: (key, value) => {
      records.set(key, value)
      return 'written'
    },
    removeItem: (key) => {
      records.delete(key)
    },
    keys: (prefix) => [...records.keys()].filter((key) => key.startsWith(prefix)),
  }
}
