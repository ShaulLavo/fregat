import { afterEach, beforeEach, vi } from 'vitest'
import * as v from 'valibot'

import { expect, test } from '../../../test/fixtures'
import {
  readWorkspaceCacheEntry,
  removeWorkspaceCacheEntry,
  workspaceCacheSerializedBytes,
  WORKSPACE_CACHE_STORAGE_PREFIX,
  workspaceCacheStorageKey,
  writeWorkspaceCacheEntry,
} from '@/lib/workspace-cache-storage'

const STORE = new Map<string, string>()
const TEST_KEY = workspaceCacheStorageKey('test')

beforeEach(() => {
  STORE.clear()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage(),
  })
})

afterEach(() => {
  STORE.clear()
  vi.restoreAllMocks()
  delete (globalThis as { localStorage?: Storage }).localStorage
})

test('round-trips a schema-validated entry under the current namespace', () => {
  const schema = v.strictObject({ value: v.string() })

  expect(writeWorkspaceCacheEntry(TEST_KEY, { value: 'kept' })).toMatchObject({
    status: 'written',
  })
  expect(readWorkspaceCacheEntry(TEST_KEY, schema, null)).toEqual({ value: 'kept' })
  expect(TEST_KEY).toBe(`${WORKSPACE_CACHE_STORAGE_PREFIX}.test`)
})

test('removes an invalid entry without touching another key', () => {
  const schema = v.strictObject({ value: v.string() })
  STORE.set(TEST_KEY, JSON.stringify({ value: 1 }))
  STORE.set('unrelated', 'keep')

  expect(readWorkspaceCacheEntry(TEST_KEY, schema, null)).toBeNull()
  expect(STORE.has(TEST_KEY)).toBe(false)
  expect(STORE.get('unrelated')).toBe('keep')
})

test('rejects an oversized entry before parsing it', () => {
  const parse = vi.spyOn(JSON, 'parse')
  const serialized = JSON.stringify({ value: 'too large' })
  STORE.set(TEST_KEY, serialized)

  expect(
    readWorkspaceCacheEntry(TEST_KEY, v.strictObject({ value: v.string() }), null, {
      maxSerializedBytes: workspaceCacheSerializedBytes(serialized) - 1,
    }),
  ).toBeNull()
  expect(parse).not.toHaveBeenCalled()
  expect(STORE.has(TEST_KEY)).toBe(false)
})

test('rejects an oversized write before localStorage and preserves its prior entry', () => {
  STORE.set(TEST_KEY, 'old')
  STORE.set('unrelated', 'keep')

  const result = writeWorkspaceCacheEntry(
    TEST_KEY,
    { value: 'too large' },
    {
      maxSerializedBytes: 1,
    },
  )

  expect(result.status).toBe('oversized')
  expect(STORE.get(TEST_KEY)).toBe('old')
  expect(STORE.get('unrelated')).toBe('keep')
})

test('serialization failure preserves the prior entry', () => {
  STORE.set(TEST_KEY, 'old')
  const circular: { self?: unknown } = {}
  circular.self = circular

  expect(writeWorkspaceCacheEntry(TEST_KEY, circular).status).toBe('serialization-failed')
  expect(STORE.get(TEST_KEY)).toBe('old')
})

test('a quota failure preserves the failed key', () => {
  STORE.set(TEST_KEY, 'old')
  STORE.set('unrelated', 'keep')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage({ failingSetKey: TEST_KEY }),
  })

  expect(writeWorkspaceCacheEntry(TEST_KEY, { value: 'next' }).status).toBe('storage-failed')
  expect(STORE.get(TEST_KEY)).toBe('old')
  expect(STORE.get('unrelated')).toBe('keep')

  removeWorkspaceCacheEntry('unrelated')
  expect(STORE.has('unrelated')).toBe(false)
})

test('a missing store reports an unavailable write', () => {
  delete (globalThis as { localStorage?: Storage }).localStorage

  expect(writeWorkspaceCacheEntry(TEST_KEY, { value: 'next' }).status).toBe('unavailable')
})

function memoryLocalStorage({ failingSetKey }: { readonly failingSetKey?: string } = {}): Storage {
  return {
    get length() {
      return STORE.size
    },
    clear: () => STORE.clear(),
    getItem: (key) => STORE.get(key) ?? null,
    key: (index) => Array.from(STORE.keys())[index] ?? null,
    removeItem: (key) => void STORE.delete(key),
    setItem: (key, value) => {
      if (key === failingSetKey) throw new DOMException('localStorage quota exceeded')

      STORE.set(key, value)
    },
  }
}
