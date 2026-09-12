import { afterEach, beforeEach, vi } from 'vitest'
import * as v from 'valibot'
import { log as evlog } from 'evlog'
import { toast } from 'sonner'

import { expect, test } from '../../../test/fixtures'
import { globalChromeStorage } from '@/lib/environments/state/scoped-storage'
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
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  vi.spyOn(evlog, 'error').mockImplementation(() => {})
  vi.spyOn(toast, 'error').mockImplementation(() => 'observed-toast')
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: memoryLocalStorage(),
  })
})

afterEach(() => {
  STORE.clear()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
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

test.each([
  {
    reason: 'invalid-json',
    serialized: '{"value":"private-cache-content"',
    maxSerializedBytes: undefined,
  },
  { reason: 'invalid-json', serialized: '', maxSerializedBytes: undefined },
  {
    reason: 'schema',
    serialized: '{"value":1,"secret":"private-cache-content"}',
    maxSerializedBytes: undefined,
  },
  { reason: 'oversized', serialized: '{"value":"private-cache-content"}', maxSerializedBytes: 1 },
])(
  'disposes $reason with one cache diagnostic and no filesystem toast',
  ({ reason, serialized, maxSerializedBytes }) => {
    STORE.set(TEST_KEY, serialized)
    STORE.set('unrelated', 'keep')

    expect(
      readWorkspaceCacheEntry(TEST_KEY, v.strictObject({ value: v.string() }), null, {
        maxSerializedBytes,
      }),
    ).toBeNull()
    expect(STORE.has(TEST_KEY)).toBe(false)
    expect(STORE.get('unrelated')).toBe('keep')
    expect(toast.error).not.toHaveBeenCalled()
    expect(evlog.error).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        action: 'client.error',
        area: 'workspace-cache',
        operation: 'cache.read',
        message: 'Invalid local cache entry was discarded.',
        context: { cacheKey: TEST_KEY, reason },
      }),
    )
    expect(JSON.stringify(vi.mocked(evlog.error).mock.calls)).not.toContain('private-cache-content')
  },
)

test('a failed read reports its key and preserves the entry because corruption is unknown', () => {
  STORE.set(TEST_KEY, '{"value":"keep"}')
  const storage = {
    ...globalChromeStorage,
    getItem() {
      throw new DOMException('Storage access blocked', 'SecurityError')
    },
  }

  expect(
    readWorkspaceCacheEntry(TEST_KEY, v.strictObject({ value: v.string() }), null, {
      storage,
    }),
  ).toBeNull()
  expect(STORE.get(TEST_KEY)).toBe('{"value":"keep"}')
  expect(toast.error).not.toHaveBeenCalled()
  expect(evlog.error).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      area: 'workspace-cache',
      operation: 'cache.read',
      message: 'Local cache could not be read.',
      context: { cacheKey: TEST_KEY, reason: 'read-failed' },
    }),
  )
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
