import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePaths } from '../path'
import { createFindContext } from '../search'
import { searchWithFallback } from '../search-fallback'
import { safeEntryStats } from '../search-shared'
import type { FindMatch, FindOptions } from '../search-shared'

// `fd`/`rg` decide which provider `findInWorkspaceStream` picks, and CI installs
// both — so the fallback is only reachable here by calling it directly.
// `measurement.snapshot().statCallCount` counts every entry the walk touched,
// which is what makes "it stopped early" an assertion instead of a stopwatch.

const DIRECTORY_COUNT = 40
const FILES_PER_DIRECTORY = 10
const TOTAL_FILES = DIRECTORY_COUNT * FILES_PER_DIRECTORY

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('workspace search fallback', () => {
  it('yields the first match before it has walked the whole tree', async () => {
    const context = await createFindContext(
      createWorkspacePaths(await wideFixtureRoot()),
      nameSearchOptions(),
    )

    const iterator = searchWithFallback(context)[Symbol.asyncIterator]()
    const first = await iterator.next()
    const statCallCount = context.measurement.snapshot().statCallCount
    await iterator.return?.(undefined)

    expect(first.done).toBe(false)
    expect(statCallCount).toBeLessThan(20)
  })

  it('stops walking when the signal aborts mid-walk', async () => {
    const context = await createFindContext(
      createWorkspacePaths(await wideFixtureRoot()),
      nameSearchOptions(),
    )
    const controller = new AbortController()
    const matches: FindMatch[] = []

    for await (const match of searchWithFallback(context, controller.signal)) {
      matches.push(match)
      if (matches.length === FILES_PER_DIRECTORY) controller.abort()
    }

    expect(matches.length).toBeLessThan(TOTAL_FILES / 2)
    expect(context.measurement.snapshot().statCallCount).toBeLessThan(TOTAL_FILES / 2)
  })

  it('walks the whole tree and returns every match when nothing cancels', async () => {
    const context = await createFindContext(
      createWorkspacePaths(await wideFixtureRoot()),
      nameSearchOptions(),
    )

    const matches = await collect(searchWithFallback(context))

    expect(matches).toHaveLength(TOTAL_FILES)
    expect(context.measurement.snapshot().statCallCount).toBeGreaterThan(TOTAL_FILES)
  })

  it('returns name and content matches in directory-walk order', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'sub'), { recursive: true })
    await writeFile(path.join(root, 'alpha-needle.txt'), 'first line\n')
    await writeFile(path.join(root, 'beta.txt'), 'needle here\n')
    await writeFile(path.join(root, 'sub', 'gamma.txt'), 'a needle\nand needle again\n')
    const context = await createFindContext(createWorkspacePaths(root), {
      includeContent: true,
      limit: 100,
      maxContentBytes: 1_000_000,
      path: '',
      query: 'needle',
    })

    const matches = await collect(searchWithFallback(context))

    expect(matches.map((match) => `${match.kind}:${match.path}:${match.line ?? 0}`)).toEqual([
      'name:alpha-needle.txt:0',
      'content:beta.txt:1',
      'content:sub/gamma.txt:1',
      'content:sub/gamma.txt:2',
    ])
  })

  it.each(['\n', '\r\n'])(
    'searches complete long physical lines with %j endings',
    async (ending) => {
      const root = await fixtureRoot()
      const prefix = ' '.repeat(65_534)
      const gap = ' '.repeat(65_536)
      await writeFile(path.join(root, 'long.txt'), `${prefix}needle${gap}needle${ending}needle`)
      const context = await createFindContext(createWorkspacePaths(root), {
        includeContent: true,
        includeNames: false,
        limit: 100,
        maxContentBytes: 1_000_000,
        path: '',
        query: 'needle',
      })

      const matches = await collect(searchWithFallback(context))

      expect(matches.map(({ line, column, endColumn }) => ({ line, column, endColumn }))).toEqual([
        { line: 1, column: 65_535, endColumn: 65_541 },
        { line: 1, column: 131_077, endColumn: 131_083 },
        { line: 2, column: 1, endColumn: 7 },
      ])
    },
  )

  it('preserves Unicode split at a long-line chunk boundary and UTF-16 columns', async () => {
    const root = await fixtureRoot()
    const prefix = ' '.repeat(65_535)
    await writeFile(
      path.join(root, 'unicode.txt'),
      `${prefix}😀 needle${' '.repeat(65_536)}\n😀 needle`,
    )
    const context = await createFindContext(createWorkspacePaths(root), {
      ...contentSearchOptions(),
      query: '😀 needle',
    })

    const matches = await collect(searchWithFallback(context))

    expect(matches.map(({ line, column, endColumn }) => ({ line, column, endColumn }))).toEqual([
      { line: 1, column: 65_536, endColumn: 65_545 },
      { line: 2, column: 1, endColumn: 10 },
    ])
    expect(matches[0]?.preview).toContain('😀 needle')
    expect(matches[0]?.preview).not.toContain('�')
  })

  it('applies regex anchors to physical lines', async () => {
    const root = await fixtureRoot()
    await writeFile(
      path.join(root, 'anchors.txt'),
      `${' '.repeat(65_530)}needle${' '.repeat(65_536)}\nneedle`,
    )
    const context = await createFindContext(createWorkspacePaths(root), {
      ...contentSearchOptions(),
      matchMode: 'regex',
      query: 'needle$',
    })

    const matches = await collect(searchWithFallback(context))

    expect(matches).toEqual([expect.objectContaining({ line: 2, column: 1, endColumn: 7 })])
  })

  it('accepts a complete long line exactly at the content byte limit', async () => {
    const root = await fixtureRoot()
    const text = `${' '.repeat(65_535)}😀 needle${' '.repeat(65_536)}\r\n`
    await writeFile(path.join(root, 'limit.txt'), text)
    const context = await createFindContext(createWorkspacePaths(root), {
      ...contentSearchOptions(),
      maxContentBytes: Buffer.byteLength(text),
    })

    const matches = await collect(searchWithFallback(context))

    expect(matches).toEqual([
      expect.objectContaining({ line: 1, column: 65_539, endColumn: 65_545 }),
    ])
  })

  it('stops at the content byte limit when a file grows after its stat', async () => {
    const root = await fixtureRoot()
    const file = path.join(root, 'growing.txt')
    await writeFile(file, 'needle\r\n')
    const context = await createFindContext(createWorkspacePaths(root), {
      ...contentSearchOptions(),
      maxContentBytes: 65_536,
    })
    await safeEntryStats(file, context.measurement, 'growing.txt', context.statCache)
    await writeFile(file, `needle\r\n${' '.repeat(65_515)}needle${' '.repeat(65_536)}\nneedle`)

    const matches = await collect(searchWithFallback(context))

    expect(matches).toEqual([expect.objectContaining({ line: 1, column: 1, endColumn: 7 })])
  })

  it('stops content search when cancelled after a yielded match', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'cancel.txt'), `needle\n${' '.repeat(131_072)}needle\nneedle`)
    const context = await createFindContext(createWorkspacePaths(root), contentSearchOptions())
    const controller = new AbortController()
    const iterator = searchWithFallback(context, controller.signal)

    try {
      expect(await iterator.next()).toMatchObject({ done: false, value: { line: 1, column: 1 } })
      controller.abort()
      expect(await iterator.next()).toMatchObject({ done: true })
    } finally {
      await iterator.return(undefined)
    }
  })

  it('keeps yielding past options.limit and leaves truncation to the consumer', async () => {
    const context = await createFindContext(createWorkspacePaths(await wideFixtureRoot()), {
      ...nameSearchOptions(),
      limit: 5,
    })

    const matches = await collect(searchWithFallback(context))

    expect(matches).toHaveLength(TOTAL_FILES)
  })
})

function contentSearchOptions(): FindOptions {
  return {
    includeContent: true,
    includeNames: false,
    limit: 100,
    maxContentBytes: 1_000_000,
    path: '',
    query: 'needle',
  }
}

function nameSearchOptions(): FindOptions {
  return {
    includeContent: false,
    limit: 100_000,
    maxContentBytes: 1_000_000,
    path: '',
    query: 'file',
  }
}

async function wideFixtureRoot() {
  const root = await fixtureRoot()

  for (let directory = 0; directory < DIRECTORY_COUNT; directory += 1) {
    const directoryPath = path.join(root, `dir-${String(directory).padStart(3, '0')}`)
    await mkdir(directoryPath, { recursive: true })
    await Promise.all(
      Array.from({ length: FILES_PER_DIRECTORY }, (_, file) =>
        writeFile(path.join(directoryPath, `file-${String(file).padStart(2, '0')}.txt`), ''),
      ),
    )
  }

  return root
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-search-fallback-'))
  roots.push(root)
  return root
}

async function collect<T>(events: AsyncIterable<T>) {
  const result: T[] = []
  for await (const event of events) result.push(event)

  return result
}
