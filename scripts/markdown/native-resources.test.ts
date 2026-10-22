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
