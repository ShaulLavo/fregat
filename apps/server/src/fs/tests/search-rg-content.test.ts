import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createWorkspacePaths } from '../path'
import { DiskWorkspaceSearchProvider, type SearchStreamEvent } from '../search'
import { parseRgMatchLine } from '../search-rg-parser'

const roots: string[] = []
const rgExecutable = Bun.which('rg')

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// These provider regressions require the real rg executable, which CI installs.
describe.skipIf(!rgExecutable)('ripgrep content events (requires rg)', () => {
  it('returns a short valid UTF-8 control through the rg provider', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'control.txt'), 'plain needle\n')

    const event = rgMatchEvent(root, 'control.txt')
    expect(event?.data.lines).toEqual({ text: 'plain needle\n' })

    const events = await search(root)
    expect(contentMatches(events)).toEqual([
      expect.objectContaining({ column: 7, endColumn: 13, preview: 'plain needle' }),
    ])
    expectCompleteRgSearch(events, 1, 1)
  })

  it('keeps all results when rg returns invalid UTF-8 content as base64 bytes', async () => {
    const root = await fixtureRoot()
    const bytes = Buffer.concat([
      Buffer.from('prefix '),
      Buffer.from([0xff]),
      Buffer.from(' needle and needle\r\nlast needle\n'),
    ])
    await writeFile(path.join(root, 'content.txt'), bytes)
    await writeFile(path.join(root, 'control.txt'), 'plain needle\n')

    const event = rgMatchEvent(root, 'content.txt')
    expect(event?.data.lines).toEqual({ bytes: bytes.subarray(0, 28).toString('base64') })
    expect(event?.data.submatches).toMatchObject([
      { start: 9, end: 15 },
      { start: 20, end: 26 },
    ])

    const events = await search(root)
    expect(contentMatches(events)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: 'control.txt',
          column: 7,
          endColumn: 13,
          preview: 'plain needle',
        }),
        expect.objectContaining({
          path: 'content.txt',
          line: 1,
          column: 10,
          endColumn: 16,
          preview: 'prefix � needle and needle',
        }),
        expect.objectContaining({
          path: 'content.txt',
          line: 1,
          column: 21,
          endColumn: 27,
          preview: 'prefix � needle and needle',
        }),
        expect.objectContaining({
          path: 'content.txt',
          line: 2,
          column: 6,
          endColumn: 12,
          preview: 'last needle',
        }),
      ]),
    )
    expectCompleteRgSearch(events, 4, 2)
  })

  it('uses original byte offsets after multibyte Unicode and malformed content', async () => {
    const root = await fixtureRoot()
    await writeFile(
      path.join(root, 'unicode.txt'),
      Buffer.concat([
        Buffer.from('é 😀 '),
        Buffer.from([0xe2, 0x82]),
        Buffer.from(' needle é needle\n'),
      ]),
    )

    const event = rgMatchEvent(root, 'unicode.txt')
    expect(event?.data.lines).toHaveProperty('bytes')
    expect(event?.data.submatches).toMatchObject([
      { start: 11, end: 17 },
      { start: 21, end: 27 },
    ])

    const events = await search(root)
    expect(contentMatches(events)).toEqual([
      expect.objectContaining({
        column: 8,
        endColumn: 14,
        preview: 'é 😀 � needle é needle',
        previewStartColumn: 0,
      }),
      expect.objectContaining({
        column: 17,
        endColumn: 23,
        preview: 'é 😀 � needle é needle',
        previewStartColumn: 0,
      }),
    ])
    expectCompleteRgSearch(events, 2, 1)
  })

  it('keeps zero-offset and supplementary Unicode ranges in byte-backed lines', async () => {
    const root = await fixtureRoot()
    await writeFile(
      path.join(root, 'unicode.txt'),
      Buffer.concat([Buffer.from('needle é '), Buffer.from([0xff]), Buffer.from(' 😀 needle\n')]),
    )

    const events = await search(root)
    expect(contentMatches(events)).toEqual([
      expect.objectContaining({ column: 1, endColumn: 7, preview: 'needle é � 😀 needle' }),
      expect.objectContaining({ column: 15, endColumn: 21, preview: 'needle é � 😀 needle' }),
    ])
    expectCompleteRgSearch(events, 2, 1)

    const emojiEvents = await search(root, '😀')
    expect(contentMatches(emojiEvents)).toEqual([
      expect.objectContaining({ column: 12, endColumn: 14, preview: 'needle é � 😀 needle' }),
    ])
    expectCompleteRgSearch(emojiEvents, 1, 1)
  })

  it('anchors bounded previews around byte-backed matches on long lines', async () => {
    const root = await fixtureRoot()
    await writeFile(
      path.join(root, 'long.txt'),
      Buffer.concat([
        Buffer.from('é 😀 '),
        Buffer.from([0xff]),
        Buffer.from(`${'x '.repeat(160)}needle\n`),
      ]),
    )

    const events = await search(root)
    const matches = contentMatches(events)
    expect(matches).toEqual([
      expect.objectContaining({
        column: 327,
        endColumn: 333,
        preview: expect.stringContaining('needle'),
      }),
    ])
    const { preview = '', column = 0, endColumn = 0, previewStartColumn = 0 } = matches[0] ?? {}
    expect(preview.length).toBeLessThanOrEqual(240)
    expect(preview.slice(column - 1 - previewStartColumn, endColumn - 1 - previewStartColumn)).toBe(
      'needle',
    )
    expectCompleteRgSearch(events, 1, 1)
  })
})

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-search-rg-content-'))
  roots.push(root)
  return root
}

function rgMatchEvent(root: string, filename: string) {
  if (!rgExecutable) return null

  const result = spawnSync(
    rgExecutable,
    ['--json', '--no-config', '--fixed-strings', 'needle', filename],
    {
      cwd: root,
      encoding: 'utf8',
      timeout: 5_000,
    },
  )
  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  return result.stdout
    .split('\n')
    .map(parseRgMatchLine)
    .find((event) => event !== null)
}

function search(root: string, query = 'needle') {
  const provider = new DiskWorkspaceSearchProvider(createWorkspacePaths(root))
  return Array.fromAsync(
    provider.search({
      includeContent: true,
      includeNames: false,
      limit: 20,
      maxContentBytes: 1_000_000,
      path: '',
      query,
    }),
  )
}

function contentMatches(events: readonly SearchStreamEvent[]) {
  return events.flatMap((event) => (event.type === 'match' ? [event.match] : []))
}

function expectCompleteRgSearch(
  events: readonly SearchStreamEvent[],
  count: number,
  fileCount: number,
) {
  expect(events.filter((event) => event.type === 'warning')).toEqual([])
  expect(events.at(-1)).toMatchObject({
    type: 'done',
    count,
    fileCount,
    truncated: false,
    measurement: { providerSources: ['rg'] },
  })
}
