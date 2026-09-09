import { afterEach, beforeEach, vi } from 'vitest'

import { expect, test } from '../../../test/fixtures'
import { testScopedStorage } from '../../../test/factories/scoped-storage'
import {
  EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES,
  EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY,
  readEditorVisibleSnapshotCache,
  removeEditorVisibleSnapshotCacheForPath,
  removeEditorVisibleSnapshotCacheForRoot,
  writeEditorVisibleSnapshotCache,
  type CachedEditorVisibleSnapshot,
} from '@/lib/editor-visible-snapshot-cache'

const values = new Map<string, string>()

beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  })
})

afterEach(() => vi.unstubAllGlobals())

test('stores opaque native paint and checks only the identity envelope', () => {
  const record = cachedSnapshot()
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')
  expect(readEditorVisibleSnapshotCache(testScopedStorage, record)).toEqual(record)
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, { ...record, rootPath: '/other' }),
  ).toBeNull()
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, { ...record, path: '/repo/b.ts' }),
  ).toBeNull()
  expect(
    readEditorVisibleSnapshotCache(testScopedStorage, { ...record, themeId: 'light' }),
  ).toBeNull()
  expect(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)).not.toBeNull()
})

test.each([
  '{broken',
  JSON.stringify({ ...cachedSnapshot(), cacheVersion: 4 }),
  JSON.stringify({ ...cachedSnapshot(), paint: {} }),
])('drops malformed and obsolete cache envelopes', (value) => {
  testScopedStorage.setItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY, value)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, cachedSnapshot())).toBeNull()
  expect(testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)).toBeNull()
})

test('refuses oversized paint while preserving the previous bounded entry', () => {
  const previous = cachedSnapshot()
  writeEditorVisibleSnapshotCache(testScopedStorage, previous)
  const oversized = { ...previous, paint: 'x'.repeat(EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES) }
  expect(writeEditorVisibleSnapshotCache(testScopedStorage, oversized).status).toBe('oversized')
  expect(readEditorVisibleSnapshotCache(testScopedStorage, previous)).toEqual(previous)
})

test('evicts only the requested path or workspace', () => {
  const record = cachedSnapshot()
  writeEditorVisibleSnapshotCache(testScopedStorage, record)
  removeEditorVisibleSnapshotCacheForPath(testScopedStorage, { ...record, path: '/repo/b.ts' })
  removeEditorVisibleSnapshotCacheForRoot(testScopedStorage, '/other')
  expect(readEditorVisibleSnapshotCache(testScopedStorage, record)).toEqual(record)
  removeEditorVisibleSnapshotCacheForPath(testScopedStorage, record)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, record)).toBeNull()
  writeEditorVisibleSnapshotCache(testScopedStorage, record)
  removeEditorVisibleSnapshotCacheForRoot(testScopedStorage, record.rootPath)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, record)).toBeNull()
})

function cachedSnapshot(): CachedEditorVisibleSnapshot {
  return {
    cacheVersion: 5,
    contentVersion: 'stat:1:5',
    rootPath: '/repo',
    path: '/repo/a.ts',
    themeId: 'dark',
    paint: 'opaque editor-owned payload',
  }
}
