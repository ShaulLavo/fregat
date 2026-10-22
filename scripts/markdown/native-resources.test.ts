import { hash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { createMarkdownSession } from '../../packages/markdown/src/utils/session'
import {
  captureNativeResourceAssets,
  resourceSession,
  summarizeResourceWindows,
  summarizeNativeResources,
  type ResourceWindow,
} from './native-resources'
import { createScriptError } from '../structured-errors'

test('a real resource session clears held blocks and projection entries even after a failed transform', () => {
  const actual = createMarkdownSession()
  let resets = 0
  const context = resourceSession({
    factory: () => ({
      update(text, options) {
        if (text === '') resets++
        return actual.update(text, options)
      },
    }),
    extensions: { raw: null, math: null },
    project: () => {
      throw createScriptError('Projection control failed.', {
        internal: { boundary: 'resource-negative-control' },
      })
    },
  })
  try {
    expect(() => context.update('# A retained heading\n\nTail', false)).toThrow(
      'Projection control',
    )
  } finally {
    expect(context.release().cleared).toBe(true)
  }
  expect(resets).toBe(1)
  expect(context.retainedProjectionEntries()).toBe(0)
  expect(context.release()).toEqual({ cleared: true, entries: 0 })
  expect(() => context.update('later', false)).toThrow('released')
})

test('settled HAST projections are released after actual streaming and completion', () => {
  const context = resourceSession({
    factory: createMarkdownSession,
    extensions: { raw: null, math: null },
  })
  try {
    context.update('# Heading\n\nA tail', true)
    context.update('# Heading\n\nA tail grows', true)
    context.update('# Heading\n\nA tail grows', false)
    expect(context.retainedProjectionEntries()).toBeGreaterThan(0)
  } finally {
    expect(context.release().entries).toBeGreaterThan(0)
  }
  expect(context.retainedProjectionEntries()).toBe(0)
})

function reading(bytes: number, wasm: number, gcPerformed = true) {
  return { heapUsedBytes: bytes, rssBytes: bytes * 2, wasmReservedBytes: wasm, gcPerformed }
}

function row(window: number, bytes: number, wasm: number): ResourceWindow {
  return {
    engine: 'tree-sitter',
    cycles: 20,
    window,
    before: reading(bytes - 1, wasm),
    after: reading(bytes, wasm),
    outputFailures: [],
    cleanupFailures: [],
    clearedSessions: 20,
    clearedProjectionEntries: 60,
  }
}

test('resource summaries retain actual growth and distinguish allocator reuse from qualification', () => {
  const growing = summarizeResourceWindows([row(0, 100, 64), row(1, 120, 128), row(2, 180, 192)])[0]
  expect(growing?.status).toBe('INCONCLUSIVE')
  expect(growing?.heapWindowDeltasBytes).toEqual([20, 60])
  expect(growing?.wasmHighWaterReuseObserved).toBe(false)
  const plateau = summarizeResourceWindows([row(0, 100, 64), row(1, 120, 64), row(2, 110, 64)])[0]
  expect(plateau?.wasmHighWaterReuseObserved).toBe(true)
  expect(plateau?.heapObservedRangeBytes).toBe(20)
  expect(plateau?.status).toBe('INCONCLUSIVE')
  expect(
    summarizeResourceWindows([{ ...row(0, 100, 64), outputFailures: ['missing-output'] }])[0]
      ?.status,
  ).toBe('FAILED')
  expect(
    summarizeResourceWindows([{ ...row(0, 100, 64), after: reading(100, 64, false) }])[0]?.gcStatus,
  ).toBe('NOT_MEASURED')
})

function plateauWindows(): ResourceWindow[] {
  return [row(0, 140, 64), row(1, 120, 64), row(2, 110, 64), row(3, 100, 64)]
}

function replaceWindow(
  rows: readonly ResourceWindow[],
  index: number,
  patch: Partial<ResourceWindow>,
): ResourceWindow[] {
  return rows.map((entry, offset) => (offset === index ? { ...entry, ...patch } : entry))
}

test('post-GC native plateaus have a conclusive native-only status with unchanged raw summaries', () => {
  const rows = plateauWindows()
  const original = structuredClone(rows)
  expect(summarizeResourceWindows(rows)).toEqual([
    {
      engine: 'tree-sitter',
      cycles: 20,
      windows: 4,
      status: 'OBSERVED_PLATEAU',
      gcStatus: 'POST_GC',
      heapAfterReleaseBytes: [140, 120, 110, 100],
      rssAfterReleaseBytes: [280, 240, 220, 200],
      wasmReservedBytes: [64, 64, 64, 64],
      heapWindowDeltasBytes: [-20, -10, -10],
      rssWindowDeltasBytes: [-40, -20, -20],
      wasmWindowDeltasBytes: [0, 0, 0],
      heapObservedRangeBytes: 40,
      wasmHighWaterReuseObserved: true,
      reason: expect.any(String),
    },
  ])
  expect(rows).toEqual(original)
})

test('native plateau uses only the last two heap and WASM deltas and treats RSS descriptively', () => {
  const rows = [row(0, 90, 32), row(1, 120, 64), row(2, 110, 64), row(3, 110, 64)]
  const risingRss = rows.map((entry, index) => ({
    ...entry,
    after: { ...entry.after, rssBytes: 1000 * (index + 1) },
  }))
  const summary = summarizeResourceWindows(risingRss)[0]
  expect(summary?.status).toBe('OBSERVED_PLATEAU')
  expect(summary?.heapWindowDeltasBytes).toEqual([30, -10, 0])
  expect(summary?.wasmWindowDeltasBytes).toEqual([32, 0, 0])
  expect(summary?.rssWindowDeltasBytes).toEqual([1000, 1000, 1000])
})

test.each([3, 8])('native plateaus accept %i consecutive windows', (windows) => {
  const rows = Array.from({ length: windows }, (_, index) => row(index, 100, 64))
  expect(summarizeResourceWindows(rows)[0]?.status).toBe('OBSERVED_PLATEAU')
})

const incompleteGroups: readonly {
  name: string
  rows: readonly ResourceWindow[]
}[] = [
  { name: 'heap growth', rows: replaceWindow(plateauWindows(), 3, { after: reading(115, 64) }) },
  {
    name: 'earlier final heap growth',
    rows: [row(0, 90, 64), row(1, 100, 64), row(2, 110, 64), row(3, 100, 64)],
  },
  { name: 'WASM growth', rows: replaceWindow(plateauWindows(), 3, { after: reading(100, 128) }) },
  { name: 'WASM shrinkage', rows: replaceWindow(plateauWindows(), 3, { after: reading(100, 32) }) },
  {
    name: 'zero WASM reservation',
    rows: plateauWindows().map((entry) => ({ ...entry, after: reading(100, 0) })),
  },
  {
    name: 'before GC missing',
    rows: replaceWindow(plateauWindows(), 0, { before: reading(100, 64, false) }),
  },
  {
    name: 'after GC missing',
    rows: replaceWindow(plateauWindows(), 0, { after: reading(100, 64, false) }),
  },
  { name: 'too few windows', rows: plateauWindows().slice(0, 2) },
  { name: 'too many windows', rows: Array.from({ length: 9 }, (_, index) => row(index, 100, 64)) },
  { name: 'duplicate window', rows: replaceWindow(plateauWindows(), 2, { window: 1 }) },
  { name: 'missing window', rows: replaceWindow(plateauWindows(), 3, { window: 4 }) },
  {
    name: 'missing initial window',
    rows: plateauWindows().map((entry) => ({ ...entry, window: entry.window + 1 })),
  },
  { name: 'fractional window', rows: replaceWindow(plateauWindows(), 1, { window: 1.5 }) },
  {
    name: 'unsupported scale',
    rows: plateauWindows().map((entry) => ({ ...entry, cycles: 99, clearedSessions: 99 })),
  },
  { name: 'negative heap', rows: replaceWindow(plateauWindows(), 0, { before: reading(-1, 64) }) },
  {
    name: 'nonfinite heap',
    rows: replaceWindow(plateauWindows(), 0, { after: reading(Number.NaN, 64) }),
  },
  {
    name: 'nonfinite RSS',
    rows: replaceWindow(plateauWindows(), 0, {
      after: { ...reading(100, 64), rssBytes: Infinity },
    }),
  },
  {
    name: 'fractional WASM',
    rows: replaceWindow(plateauWindows(), 0, { before: reading(100, 64.5) }),
  },
]

test.each(incompleteGroups)('native plateau stays inconclusive for $name', ({ rows }) => {
  expect(summarizeResourceWindows(rows)[0]?.status).toBe('INCONCLUSIVE')
})

const failedGroups: readonly { name: string; patch: Partial<ResourceWindow> }[] = [
  { name: 'output failure', patch: { outputFailures: ['source'] } },
  { name: 'cleanup failure', patch: { cleanupFailures: ['source'] } },
  { name: 'uncleared session', patch: { clearedSessions: 19 } },
  { name: 'extra cleared session', patch: { clearedSessions: 21 } },
  { name: 'zero cleared projections', patch: { clearedProjectionEntries: 0 } },
  { name: 'fractional cleared projections', patch: { clearedProjectionEntries: 1.5 } },
]

test.each(failedGroups)('native plateau fails for $name', ({ patch }) => {
  expect(summarizeResourceWindows(replaceWindow(plateauWindows(), 0, patch))[0]?.status).toBe(
    'FAILED',
  )
})

function completePlateauWindows(): ResourceWindow[] {
  const groups: readonly Pick<ResourceWindow, 'engine' | 'cycles'>[] = [
    { engine: 'remark', cycles: 20 },
    { engine: 'remark', cycles: 100 },
    { engine: 'remark', cycles: 500 },
    { engine: 'tree-sitter', cycles: 20 },
    { engine: 'tree-sitter', cycles: 100 },
    { engine: 'tree-sitter', cycles: 500 },
  ]
  return groups.flatMap((group) =>
    plateauWindows().map((entry) => ({ ...entry, ...group, clearedSessions: group.cycles })),
  )
}

test('native report status requires all six engine and cycle plateaus', () => {
  const rows = completePlateauWindows()
  const original = structuredClone(rows)
  const summary = summarizeNativeResources(rows)
  expect(summary.nativeStatus).toBe('OBSERVED_PLATEAU')
  expect(summary.summaries).toHaveLength(6)
  expect(summary.summaries.every((group) => group.status === 'OBSERVED_PLATEAU')).toBe(true)
  expect(rows).toEqual(original)
  expect(summarizeNativeResources(rows.toReversed()).nativeStatus).toBe('OBSERVED_PLATEAU')
  expect(summarizeNativeResources([])).toEqual({ nativeStatus: 'INCONCLUSIVE', summaries: [] })
})

test.each([
  { engine: 'remark', cycles: 20 },
  { engine: 'remark', cycles: 100 },
  { engine: 'remark', cycles: 500 },
  { engine: 'tree-sitter', cycles: 20 },
  { engine: 'tree-sitter', cycles: 100 },
  { engine: 'tree-sitter', cycles: 500 },
])('native report is inconclusive with missing $engine/$cycles group', ({ engine, cycles }) => {
  const rows = completePlateauWindows().filter(
    (entry) => entry.engine !== engine || entry.cycles !== cycles,
  )
  expect(summarizeNativeResources(rows).nativeStatus).toBe('INCONCLUSIVE')
})

test.each(incompleteGroups)('one $name group blocks the native report plateau', ({ rows }) => {
  const rest = completePlateauWindows().filter(
    (entry) => entry.engine !== 'tree-sitter' || entry.cycles !== 20,
  )
  expect(summarizeNativeResources(rest.concat(rows)).nativeStatus).toBe('INCONCLUSIVE')
})

test.each(failedGroups)('one $name fails the native report', ({ patch }) => {
  const rows = replaceWindow(completePlateauWindows(), 0, patch)
  expect(summarizeNativeResources(rows).nativeStatus).toBe('FAILED')
})

test('extra unsupported groups and duplicated raw rows block the native report plateau', () => {
  const rows = completePlateauWindows()
  const extra = plateauWindows().map((entry) => ({ ...entry, cycles: 99, clearedSessions: 99 }))
  expect(summarizeNativeResources(rows.concat(extra)).nativeStatus).toBe('INCONCLUSIVE')
  expect(summarizeNativeResources(rows.concat(rows)).nativeStatus).toBe('INCONCLUSIVE')
})

const temporary = new Set<string>()
afterEach(async () => {
  for (const directory of temporary) await rm(directory, { recursive: true, force: true })
  temporary.clear()
})

async function assetFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'native-resource-assets-'))
  temporary.add(root)
  const parser = path.join(root, 'node_modules/tree-sitter-md')
  await mkdir(path.join(root, 'packages/markdown'), { recursive: true })
  await mkdir(parser, { recursive: true })
  await writeFile(path.join(root, 'packages/markdown/package.json'), '{}')
  await writeFile(path.join(parser, 'package.json'), JSON.stringify({ name: 'tree-sitter-md' }))
  const files = [
    { asset: 'tree-sitter-markdown.wasm', bytes: 'base grammar bytes' },
    { asset: 'tree-sitter-markdown-chat.wasm', bytes: 'distinct CHAT grammar bytes' },
    { asset: 'tree-sitter-md.wasm', bytes: 'resolver bytes' },
  ]
  for (const { asset, bytes } of files) await writeFile(path.join(parser, asset), bytes)
  return { root, parser, files, output: path.join(root, 'evidence') }
}

test('native resource capture copies and hashes distinct base, CHAT and resolver assets', async () => {
  const fixture = await assetFixture()
  const assets = await captureNativeResourceAssets(fixture.root, fixture.output)
  expect(assets.map((row) => row.asset)).toEqual(fixture.files.map((row) => row.asset))
  expect(new Set(assets.map((row) => row.sha256)).size).toBe(3)
  for (const row of assets) {
    const actual = await readFile(path.join(fixture.output, row.file))
    expect(row.sha256).toBe(hash('sha256', actual, 'hex'))
    expect(row.bytes).toBe(actual.length)
    expect(actual).toEqual(await readFile(path.join(fixture.parser, row.asset)))
  }
})

test.each(['tree-sitter-markdown.wasm', 'tree-sitter-markdown-chat.wasm', 'tree-sitter-md.wasm'])(
  'native resource capture rejects a missing actual asset %s',
  async (asset) => {
    const fixture = await assetFixture()
    await rm(path.join(fixture.parser, asset))
    await expect(captureNativeResourceAssets(fixture.root, fixture.output)).rejects.toThrow()
  },
)
