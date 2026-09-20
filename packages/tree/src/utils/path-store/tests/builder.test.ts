import { describe, expect, it } from 'vitest'

import { PathStoreBuilder, preparePathEntries } from '../builder'
import type { SegmentSortKey } from '../internal-types'
import { parseInputPath } from '../path'
import { comparePreparedPaths, comparePreparedPathsWithCachedSortKeys } from '../sort'
import { PathStore } from '../store'

const ORDERED_FILES = [
  'src/dir2/a.ts',
  'src/dir10/a.ts',
  'src/File2.ts',
  'src/file2.ts',
  'src/file10.ts',
  'README.md',
]
const INGESTION_MODES = ['paths', 'prepared', 'presorted-files', 'presorted-directories'] as const

describe('builder ingestion modes', () => {
  it.each(INGESTION_MODES)('keeps natural order and mutable indexes after %s ingestion', (mode) => {
    const files = Array.from({ length: 160 }, (_, index) => `src/file${index}.ts`)
    const store = createStore(mode, [...files, 'empty/', 'nested/deep/a.ts'])
    expect(store.list()).toEqual(['empty/', 'nested/deep/a.ts', ...files])
    store.batch([
      { type: 'add', path: 'src/file160.ts' },
      { type: 'remove', path: 'src/file63.ts' },
      { type: 'move', from: 'nested/deep/a.ts', to: 'src/file64a.ts' },
    ])
    store.remove('nested/', { recursive: true })
    store.remove('empty/')
    const expected = [...files.filter((path) => path !== 'src/file63.ts'), 'src/file160.ts']
    expected.splice(expected.indexOf('src/file64.ts') + 1, 0, 'src/file64a.ts')
    expect(store.list()).toEqual(expected)
    expect(store.getVisibleCount()).toBe(expected.length + 1)
    expect(store.getVisibleSlice(0, expected.length).map((row) => row.path)).toEqual([
      'src/',
      ...expected,
    ])
    expect(expected.map((path) => store.getVisibleIndex(path))).toEqual(
      expected.map((_, index) => index + 1),
    )
    const projection = store.getVisibleTreeProjectionData()
    expect(projection.posInSetByIndex).toBeInstanceOf(Int32Array)
    expect(projection.setSizeByIndex).toBeInstanceOf(Int32Array)
    expect(Array.from(projection.posInSetByIndex)).toEqual([
      0,
      ...expected.map((_, index) => index),
    ])
    expect(Array.from(projection.setSizeByIndex)).toEqual([
      1,
      ...expected.map(() => expected.length),
    ])
  })

  it('orders directories, numeric segments, and case ties identically with cached keys', () => {
    const entries = ORDERED_FILES.toReversed().map(parseInputPath)
    const cache = new Map<string, SegmentSortKey>()
    expect(entries.toSorted(comparePreparedPaths).map((entry) => entry.path)).toEqual(ORDERED_FILES)
    expect(
      entries
        .toSorted((left, right) => comparePreparedPathsWithCachedSortKeys(left, right, cache))
        .map((entry) => entry.path),
    ).toEqual(ORDERED_FILES)
    expect(cache.size).toBeGreaterThan(0)
  })

  it('preserves node layout when deferred indexes are flushed before a checked append', () => {
    const files = ['src/a.ts', 'src/b.ts']
    const deferred = new PathStoreBuilder()
      .appendPresortedPaths(files, false)
      .appendPaths(['src/c.ts', 'z.ts'])
      .finish()
    const checked = new PathStoreBuilder().appendPaths([...files, 'src/c.ts', 'z.ts']).finish()
    expect(deferred.nodes).toEqual(checked.nodes)
    expect(deferred.directories).toEqual(checked.directories)
    expect(deferred.segmentTable.valueById).toEqual(checked.segmentTable.valueById)
  })

  it('uses the same node layout for checked and trusted prepared paths', () => {
    const entries = preparePathEntries(['src/', ...ORDERED_FILES])
    const checked = new PathStoreBuilder().appendPreparedPaths(entries).finish()
    const trusted = new PathStoreBuilder().appendPreparedPaths(entries, false).finish()
    expect(trusted).toEqual(checked)
  })

  it('honors custom comparators while validating incremental order', () => {
    const reverse = new PathStoreBuilder({
      sort: (left, right) => right.path.localeCompare(left.path),
    })
    expect(reverse.appendPaths(['z.ts', 'a.ts']).finish().segmentTable.valueById).toEqual([
      '',
      'z.ts',
      'a.ts',
    ])
    expect(() => reverse.appendPaths(['b.ts'])).toThrow('must be sorted')
  })

  it.each([
    { paths: ['a.ts', 'a.ts'], error: 'Duplicate path' },
    { paths: ['b.ts', 'a.ts'], error: 'must be sorted' },
    { paths: ['a', 'a/child.ts'], error: 'existing file' },
    { paths: ['a/', 'a'], error: 'existing entry' },
  ])('rejects invalid checked input $paths', ({ paths, error }) => {
    expect(() => new PathStoreBuilder().appendPaths(paths)).toThrow(error)
  })

  it.each([false, true, null])('rejects adjacent duplicates with directory hint %s', (hint) => {
    expect(() =>
      new PathStoreBuilder().appendPresortedPaths(['src/a.ts', 'src/a.ts'], hint),
    ).toThrow('Duplicate path')
  })

  it('tracks fully expanded file-only startup hints without including files', () => {
    const store = new PathStore({
      initialExpandedPaths: ['src/', 'src/dir2', 'src/dir10/'],
      preparedInput: PathStore.preparePresortedInput(ORDERED_FILES),
      flattenEmptyDirectories: false,
    })
    expect(store.getVisibleCount()).toBe(ORDERED_FILES.length + 3)
    expect(store.getVisibleSlice(0, 20).map((row) => row.path)).toEqual([
      'src/',
      'src/dir2/',
      'src/dir2/a.ts',
      'src/dir10/',
      'src/dir10/a.ts',
      'src/File2.ts',
      'src/file2.ts',
      'src/file10.ts',
      'README.md',
    ])
  })
})

function createStore(mode: (typeof INGESTION_MODES)[number], paths: string[]): PathStore {
  const options = { flattenEmptyDirectories: false, initialExpansion: 'open' } as const
  if (mode === 'paths') return new PathStore({ ...options, paths })
  if (mode === 'prepared')
    return new PathStore({ ...options, preparedInput: PathStore.prepareInput(paths) })
  const input = mode === 'presorted-files' ? paths.filter((path) => !path.endsWith('/')) : paths
  const store = new PathStore({
    ...options,
    preparedInput: PathStore.preparePresortedInput(PathStore.preparePaths(input)),
  })
  if (mode === 'presorted-files') store.add('empty/')
  return store
}
