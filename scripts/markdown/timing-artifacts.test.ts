import { createHash } from 'node:crypto'
import {
  access,
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test as base } from 'vitest'
import { createScriptError } from '../structured-errors'
import { foldJsonl, hashFile, writeJsonl, type RawTimingRef } from './timing-artifacts'

const test = base.extend<{ root: string }>({
  // oxlint-disable-next-line no-empty-pattern -- Vitest discovers fixture dependencies from this pattern.
  root: async ({}, provide) => {
    const root = await mkdtemp(path.join(tmpdir(), 'timing-artifacts-'))
    try {
      await mkdir(path.join(root, 'evidence'))
      await provide(root)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  },
})

function evidence(root: string) {
  return path.join(root, 'evidence')
}

async function* records<T>(values: readonly T[]) {
  for (const value of values) yield value
}

function digest(bytes: Uint8Array) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function capture(root: string, contents: string | Uint8Array, recordCount = 1) {
  const file = 'raw.jsonl'
  const bytes = typeof contents === 'string' ? Buffer.from(contents) : contents
  await writeFile(path.join(root, file), bytes)
  const expected: RawTimingRef = {
    path: file,
    sha256: digest(bytes),
    byteLength: bytes.byteLength,
    recordCount,
  }
  return { root, file, expected, parse: (value: unknown) => value }
}

async function descriptorsFor(file: string) {
  if (process.platform !== 'linux') return []
  const descriptors = await readdir('/proc/self/fd')
  const targets = await Promise.all(
    descriptors.map(async (descriptor) => readlink(`/proc/self/fd/${descriptor}`).catch(() => '')),
  )
  return targets.filter((target) => target === file)
}

test('hashes actual bytes independently, including empty files', async ({ root }) => {
  const bytes = Buffer.from('one\r\né😀\\"\u0000\n')
  const file = path.join(evidence(root), 'bytes')
  await writeFile(file, bytes)
  expect(await hashFile({ root: evidence(root), file })).toEqual({
    path: 'bytes',
    sha256: digest(bytes),
    byteLength: bytes.length,
  })
  await writeFile(file, '')
  expect(await hashFile({ root: evidence(root), file: 'bytes' })).toEqual({
    path: 'bytes',
    sha256: digest(Buffer.alloc(0)),
    byteLength: 0,
  })
})

test('round trips every raw JSON field and preserves encounter order', async ({ root }) => {
  const values = [
    {
      workload: 'mixed',
      pair: -3,
      engine: 'remark',
      nested: {
        text: 'é😀\n"\\',
        nullCpu: null,
        receipts: [{ revision: 1, live: false }],
        excluded: ['reason'],
        arbitrary: { value: 42 },
      },
    },
    {
      workload: 'mixed',
      pair: 19,
      engine: 'candidate',
      nested: { text: '', nullCpu: null, receipts: [], excluded: [], arbitrary: { value: 0 } },
    },
  ]
  const options = { root: evidence(root), file: 'raw.jsonl' }
  const written = await writeJsonl({ ...options, records: records(values) })
  const bytes = await readFile(path.join(options.root, options.file))
  expect(written).toEqual({
    path: options.file,
    sha256: digest(bytes),
    byteLength: bytes.length,
    recordCount: 2,
  })
  expect(bytes.toString()).toBe(values.map((value) => `${JSON.stringify(value)}\n`).join(''))
  const found: unknown[] = []
  expect(
    await foldJsonl({
      ...options,
      expected: written,
      parse: (value) => value,
      consume: (value, index) => {
        expect(index).toBe(found.length)
        found.push(value)
      },
    }),
  ).toEqual(written)
  expect(found).toEqual(values)
})

for (const token of ['é', '😀', '"', '\\']) {
  test(`decodes tiny ${JSON.stringify(token)} tokens split at file chunk boundaries`, async ({
    root,
  }) => {
    const text = 'x'.repeat(65_536 - Buffer.byteLength('{"text":"') - 1) + token
    const options = await capture(evidence(root), `${JSON.stringify({ text })}\r\n`)
    const found: unknown[] = []
    await foldJsonl({
      ...options,
      consume: (value) => {
        found.push(value)
      },
    })
    expect(found).toEqual([{ text }])
  })
}

test('accepts CRLF split between chunks and requires final LF', async ({ root }) => {
  const value = 'x'.repeat(65_536 - Buffer.byteLength('{"text":""}') - 1)
  const options = await capture(evidence(root), `${JSON.stringify({ text: value })}\r\n`)
  await expect(foldJsonl({ ...options, consume: () => {} })).resolves.toEqual(options.expected)
  const truncated = await capture(evidence(root), '{"ok":true}')
  await expect(foldJsonl({ ...truncated, consume: () => {} })).rejects.toThrow(/LF|terminat/i)
})

const malformed = [
  Buffer.from([0x22, 0xc3, 0x28, 0x22, 0x0a]),
  Buffer.from([0x22, 0xe2, 0x82]),
  Buffer.from('{"broken":\n'),
  Buffer.from('{"ok":true}\n\n'),
  Buffer.from('{"ok":true}\n{"truncated":'),
]
for (const [index, bytes] of malformed.entries()) {
  test(`rejects malformed UTF-8, JSON, empty records, and truncation ${index}`, async ({
    root,
  }) => {
    const options = await capture(evidence(root), bytes)
    await expect(foldJsonl({ ...options, consume: () => {} })).rejects.toThrow()
  })
}

test('checks EOF bytes, size, count, and exact referenced path', async ({ root }) => {
  const options = await capture(evidence(root), '{"pair":19}\n')
  await writeFile(path.join(options.root, options.file), '{"pair":18}\n')
  await expect(foldJsonl({ ...options, consume: () => {} })).rejects.toThrow(/digest|sha256/i)
  await writeFile(path.join(options.root, options.file), '{"pair":19}\n')
  await appendFile(path.join(options.root, options.file), '{"late":true}\n')
  await expect(foldJsonl({ ...options, consume: () => {} })).rejects.toThrow(
    /digest|size|length|count/i,
  )
  const fresh = await capture(evidence(root), '{"pair":19}\n')
  await expect(
    foldJsonl({
      ...fresh,
      expected: { ...fresh.expected, byteLength: fresh.expected.byteLength + 1 },
      consume: () => {},
    }),
  ).rejects.toThrow(/size|length/i)
  await expect(
    foldJsonl({ ...fresh, expected: { ...fresh.expected, recordCount: 2 }, consume: () => {} }),
  ).rejects.toThrow(/count/i)
  await expect(
    foldJsonl({
      ...fresh,
      expected: { ...fresh.expected, path: 'other.jsonl' },
      consume: () => {},
    }),
  ).rejects.toThrow(/path/i)
})

test('awaits each consumer and never prefetches another parsed record', async ({ root }) => {
  const options = await capture(evidence(root), '1\n2\n3\n', 3)
  const seen: number[] = []
  let parsed = 0
  let pending = 0
  let peak = 0
  await foldJsonl({
    ...options,
    parse: (value) => {
      expect(pending).toBe(0)
      parsed++
      return value
    },
    consume: async (_value, index) => {
      pending++
      peak = Math.max(peak, pending)
      expect(parsed).toBe(index + 1)
      await new Promise<void>((resolve) => setImmediate(resolve))
      seen.push(index)
      pending--
    },
  })
  expect(seen).toEqual([0, 1, 2])
  expect(peak).toBe(1)
})

test('closes the actual input handle when parse or consume rejects', async ({ root }) => {
  const options = await capture(evidence(root), '1\n2\n', 2)
  const file = path.join(options.root, options.file)
  const before = await descriptorsFor(file)
  const failure = createScriptError('callback rejected', { internal: { phase: 'test' } })
  await expect(
    foldJsonl({
      ...options,
      parse: () => {
        throw failure
      },
      consume: () => {},
    }),
  ).rejects.toBe(failure)
  await expect(
    foldJsonl({
      ...options,
      consume: async () => {
        throw failure
      },
    }),
  ).rejects.toBe(failure)
  expect(await descriptorsFor(file)).toEqual(before)
})

test('awaits producer records and seals only after EOF', async ({ root }) => {
  const options = { root: evidence(root), file: 'raw.jsonl' }
  async function* source() {
    yield { first: true }
    await expect(access(path.join(options.root, options.file))).rejects.toThrow()
    yield { last: true }
  }
  expect((await writeJsonl({ ...options, records: source() })).recordCount).toBe(2)
  expect(await readdir(options.root)).toEqual(['raw.jsonl'])
})

test('removes temporary files on producer or serialization failure and preserves existing files', async ({
  root,
}) => {
  const options = { root: evidence(root), file: 'raw.jsonl' }
  async function* broken() {
    yield { first: true }
    throw createScriptError('producer rejected', { internal: { phase: 'test' } })
  }
  await expect(writeJsonl({ ...options, records: broken() })).rejects.toThrow('producer rejected')
  await expect(writeJsonl({ ...options, records: records([undefined]) })).rejects.toThrow()
  expect(await readdir(options.root)).toEqual([])
  await writeFile(path.join(options.root, options.file), 'owner data')
  await expect(writeJsonl({ ...options, records: records([1]) })).rejects.toThrow()
  expect(await readFile(path.join(options.root, options.file), 'utf8')).toBe('owner data')
  expect(await readdir(options.root)).toEqual(['raw.jsonl'])
})

test('rejects traversal and escaped symlink reads and writes', async ({ root }) => {
  await writeFile(path.join(root, 'outside'), '1\n')
  await symlink(root, path.join(evidence(root), 'escape'), 'dir')
  await symlink(path.join(root, 'outside'), path.join(evidence(root), 'alias'))
  await expect(hashFile({ root: evidence(root), file: '../outside' })).rejects.toThrow()
  await expect(hashFile({ root: evidence(root), file: 'alias' })).rejects.toThrow()
  await expect(hashFile({ root: evidence(root), file: 'escape/outside' })).rejects.toThrow()
  await expect(
    writeJsonl({ root: evidence(root), file: 'escape/new.jsonl', records: records([1]) }),
  ).rejects.toThrow()
  await expect(
    writeJsonl({ root: evidence(root), file: '../new.jsonl', records: records([1]) }),
  ).rejects.toThrow()
  expect(await readFile(path.join(root, 'outside'), 'utf8')).toBe('1\n')
})

test('rejects an actual file replaced during a consumer callback', async ({ root }) => {
  const options = await capture(evidence(root), '1\n2\n', 2)
  await expect(
    foldJsonl({
      ...options,
      consume: async (_value, index) => {
        if (index !== 0) return
        const replacement = path.join(options.root, 'replacement')
        await writeFile(replacement, '1\n2\n')
        await rename(replacement, path.join(options.root, options.file))
      },
    }),
  ).rejects.toThrow(/changed/i)
})

test('binds an in-root symlink to the canonical referenced file', async ({ root }) => {
  const options = await capture(evidence(root), '1\n')
  await symlink('raw.jsonl', path.join(options.root, 'alias'))
  expect(await hashFile({ root: options.root, file: 'alias' })).toEqual(await hashFile(options))
  await expect(foldJsonl({ ...options, file: 'alias', consume: () => {} })).resolves.toEqual(
    options.expected,
  )
  await expect(
    foldJsonl({
      ...options,
      file: 'alias',
      expected: { ...options.expected, path: 'alias' },
      consume: () => {},
    }),
  ).rejects.toThrow(/path/i)
})

test('seals and reads an empty raw stream without inventing records', async ({ root }) => {
  const options = { root: evidence(root), file: 'empty.jsonl' }
  const expected = await writeJsonl({ ...options, records: records([]) })
  expect(expected.recordCount).toBe(0)
  let observed = 0
  await expect(
    foldJsonl({
      ...options,
      expected,
      parse: (value) => value,
      consume: () => {
        observed++
      },
    }),
  ).resolves.toEqual(expected)
  expect(observed).toBe(0)
})
