import { hash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import { recordStatistics } from './promotion-evidence-full-assembly-fixture'

async function withRaw(
  lines: readonly string[],
  run: (root: string, raw: Buffer) => Promise<void>,
) {
  const root = await mkdtemp(path.join(tmpdir(), 'fixture-statistics-'))
  try {
    const raw = Buffer.from(lines.join('\n') + (lines.length ? '\n' : ''))
    await writeFile(path.join(root, 'raw.jsonl'), raw)
    await run(root, raw)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function reference(raw: Buffer, recordCount: number) {
  return { path: 'raw.jsonl', sha256: hash('sha256', raw), byteLength: raw.length, recordCount }
}

const controls = [
  { pair: -3, family: 'warm-completed' },
  { pair: 0, family: 'resources' },
  { pair: -1, family: 'resources' },
  { pair: 1, family: 'resources' },
] as const

test('keeps exact UTF-8 byte offsets, LF lengths and first/last control positions', async () => {
  const lines = [
    '{ "pair": -3, "family": "warm-completed", "text": "אב🙂" }',
    JSON.stringify({ pair: 0, family: 'resources', text: 'é'.repeat(70_000) }),
    '{"pair":-1,"family":"resources","text":"last warmup"}',
    '{"pair":1,"family":"resources","text":"last record\\n"}',
  ]
  await withRaw(lines, async (root, raw) => {
    const stats = await recordStatistics(root, reference(raw, lines.length), controls)
    const lengths = lines.map((line) => Buffer.byteLength(line) + 1)
    const offset = lengths[0] + lengths[1]
    expect(stats).toEqual({
      ...reference(raw, 4),
      largestRecord: lengths[1],
      lastWarmup: { offset, bytes: lengths[2] },
      firstResource: { offset: lengths[0], bytes: lengths[1] },
      lastRecord: { offset: offset + lengths[2], bytes: lengths[3] },
      maximumPendingRecords: 1,
    })
    expect(
      JSON.parse(await readFile(path.join(root, 'raw.jsonl.statistics.json'), 'utf8')),
    ).toEqual(stats)
    expect(raw.subarray(stats.lastRecord.offset).toString()).toBe(lines[3] + '\n')
  })
})

test('leaves absent controls empty and counts an empty archive', async () => {
  await withRaw([], async (root, raw) => {
    expect(await recordStatistics(root, reference(raw, 0))).toEqual({
      ...reference(raw, 0),
      largestRecord: 0,
      lastWarmup: null,
      firstResource: null,
      lastRecord: { offset: 0, bytes: 0 },
      maximumPendingRecords: 0,
    })
  })
})

test('does not treat nested native pair fields as production control positions', async () => {
  await withRaw(['{"workload":"native","pair":{"trial":-1}}'], async (root, raw) => {
    const stats = await recordStatistics(root, reference(raw, 1))
    expect(stats.lastWarmup).toBeNull()
    expect(stats.firstResource).toBeNull()
    expect(stats.lastRecord).toEqual({ offset: 0, bytes: raw.length })
  })
})

test('rejects a missing final LF even with a matching hash and byte length', async () => {
  await withRaw(['{"pair":0}'], async (root, raw) => {
    const truncated = raw.subarray(0, -1)
    await writeFile(path.join(root, 'raw.jsonl'), truncated)
    await expect(recordStatistics(root, reference(truncated, 1))).rejects.toThrow(/final LF/)
  })
})

test('checks the raw hash, byte length and count bindings', async () => {
  await withRaw(['{"pair":0}'], async (root, raw) => {
    const expected = reference(raw, 1)
    await expect(recordStatistics(root, { ...expected, sha256: '0'.repeat(64) })).rejects.toThrow()
    await expect(
      recordStatistics(root, { ...expected, byteLength: raw.length + 1 }),
    ).rejects.toThrow()
    await expect(recordStatistics(root, { ...expected, recordCount: 2 })).rejects.toThrow()
  })
})

test('rejects a production metadata count that cannot bind to every raw row', async () => {
  await withRaw(['{"pair":0,"family":"resources"}'], async (root, raw) => {
    await expect(recordStatistics(root, reference(raw, 1), [])).rejects.toThrow(
      /raw artifact reference/,
    )
    await expect(recordStatistics(root, reference(raw, 1), controls)).rejects.toThrow(
      /raw artifact reference/,
    )
  })
})

test('counts records whose LF ends a stream chunk and whose UTF-8 spans chunks', async () => {
  const first = JSON.stringify({ text: 'a'.repeat(65_524) })
  const second = JSON.stringify({ text: '🙂'.repeat(32_769) })
  await withRaw([first, second], async (root, raw) => {
    const stats = await recordStatistics(root, reference(raw, 2))
    expect(Buffer.byteLength(first) + 1).toBe(65_536)
    expect(stats.lastRecord).toEqual({ offset: 65_536, bytes: Buffer.byteLength(second) + 1 })
    expect(stats.largestRecord).toBe(Buffer.byteLength(second) + 1)
  })
})
