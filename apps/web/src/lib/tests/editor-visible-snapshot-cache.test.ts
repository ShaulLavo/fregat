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
  JSON.stringify(cachedSnapshot()),
  JSON.stringify([{ ...cachedSnapshot(), cacheVersion: 4 }]),
  JSON.stringify([{ ...cachedSnapshot(), paint: {} }]),
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

test('keeps colored paints for both tabs when switching back and forth', () => {
  const first = cachedSnapshot()
  const second = { ...first, path: '/repo/b.ts' }
  writeEditorVisibleSnapshotCache(testScopedStorage, first)
  writeEditorVisibleSnapshotCache(testScopedStorage, second)

  expect(readEditorVisibleSnapshotCache(testScopedStorage, first)).toEqual(first)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, second)).toEqual(second)
  const updated = { ...first, contentVersion: 'stat:2:5', paint: 'updated paint' }
  writeEditorVisibleSnapshotCache(testScopedStorage, updated)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, first)).toEqual(updated)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, second)).toEqual(second)

  removeEditorVisibleSnapshotCacheForPath(testScopedStorage, first)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, first)).toBeNull()
  expect(readEditorVisibleSnapshotCache(testScopedStorage, second)).toEqual(second)
})

test('evicts the oldest capture within the total byte budget', () => {
  const first = {
    ...cachedSnapshot(),
    paint: 'x'.repeat(Math.floor(EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES / 5)),
  }
  const second = { ...first, path: '/repo/b.ts' }
  const third = { ...first, path: '/repo/c.ts' }
  for (const record of [first, second, first, third]) {
    expect(writeEditorVisibleSnapshotCache(testScopedStorage, record).status).toBe('written')
  }
  expect(readEditorVisibleSnapshotCache(testScopedStorage, first)).toEqual(first)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, second)).toBeNull()
  expect(readEditorVisibleSnapshotCache(testScopedStorage, third)).toEqual(third)
  const stored = testScopedStorage.getItem(EDITOR_VISIBLE_SNAPSHOT_CACHE_STORAGE_KEY)!
  expect(stored.length * 2).toBeLessThanOrEqual(EDITOR_VISIBLE_SNAPSHOT_CACHE_MAX_BYTES)
})

test('invalidates all themes for a path and preserves other workspaces', () => {
  const first = cachedSnapshot()
  const light = { ...first, themeId: 'light' }
  const other = { ...first, rootPath: '/other', path: '/other/a.ts' }
  for (const record of [first, light, other])
    writeEditorVisibleSnapshotCache(testScopedStorage, record)
  removeEditorVisibleSnapshotCacheForPath(testScopedStorage, first)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, first)).toBeNull()
  expect(readEditorVisibleSnapshotCache(testScopedStorage, light)).toBeNull()
  expect(readEditorVisibleSnapshotCache(testScopedStorage, other)).toEqual(other)
  writeEditorVisibleSnapshotCache(testScopedStorage, first)
  removeEditorVisibleSnapshotCacheForRoot(testScopedStorage, first.rootPath)
  expect(readEditorVisibleSnapshotCache(testScopedStorage, first)).toBeNull()
  expect(readEditorVisibleSnapshotCache(testScopedStorage, other)).toEqual(other)
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
