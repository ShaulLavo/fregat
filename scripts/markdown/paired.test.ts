import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { lstat, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { blockToHast } from '../../packages/markdown/src/utils/hast'
import { expect, test } from 'vitest'
import { createMarkdownSession } from '../../packages/markdown/src/utils/session'
import {
  digestProjection,
  inspectSourceCorrespondence,
  mismatchedRevisions,
  nativePairWorkloads,
  pairedConfidence,
  pairedTrialOrders,
  publishNativeReport,
  runNativeTrial,
  writeNativePairs,
  type NativeTrial,
  type NativeRevision,
} from './paired-native'

type Root = ReturnType<typeof blockToHast>

test('seeded AB/BA orders are balanced across twenty fresh paired trials', () => {
  const orders = pairedTrialOrders(20, 176)
  expect(orders).toEqual(pairedTrialOrders(20, 176))
  expect(orders.filter((order) => order[0] === 'remark')).toHaveLength(10)
  expect(orders.every((order, index) => index === 0 || order[0] !== orders[index - 1][0])).toBe(
    true,
  )
  expect(() => pairedTrialOrders(0, 1)).toThrow()
})

test('complete HAST digests preserve nesting, destinations and every ordered child', () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { href: 'https://example.test/a', title: 'A' },
        children: [{ type: 'text', value: 'label' }],
      },
    ],
  }
  const reordered: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { title: 'A', href: 'https://example.test/a' },
        children: [{ type: 'text', value: 'label' }],
      },
    ],
  }
  const changed: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'a',
        properties: { href: 'https://example.test/b', title: 'A' },
        children: [{ type: 'text', value: 'label' }],
      },
    ],
  }
  expect(digestProjection(root)).toBe(digestProjection(reordered))
  expect(digestProjection(root)).not.toBe(digestProjection(changed))
  expect(digestProjection(root)).not.toBe(digestProjection({ type: 'root', children: [] }))
})

test('private text segmentation and container padding preserve exact rendered semantics', () => {
  const source = '| cell |'
  const content = {
    start: { line: 1, column: 3, offset: 2 },
    end: { line: 1, column: 7, offset: 6 },
  }
  const wide: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'th',
        properties: { dataSourceLine: 1, dataSourceEndLine: 1, style: 'text-align: right' },
        position: {
          start: { line: 1, column: 1, offset: 0 },
          end: { line: 1, column: 9, offset: 8 },
        },
        children: [{ type: 'text', value: 'cell', position: content }],
      },
    ],
  }
  const narrow: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'th',
        properties: { dataSourceLine: 1, dataSourceEndLine: 1, style: 'text-align: right' },
        position: content,
        children: [
          {
            type: 'text',
            value: 'ce',
            position: { start: content.start, end: { line: 1, column: 5, offset: 4 } },
          },
          {
            type: 'text',
            value: 'll',
            position: { start: { line: 1, column: 5, offset: 4 }, end: content.end },
          },
        ],
      },
    ],
  }
  expect(digestProjection(wide)).toBe(digestProjection(narrow))
  const wideSource = inspectSourceCorrespondence(wide, source)
  const narrowSource = inspectSourceCorrespondence(narrow, source)
  expect(wideSource.sourceCoordinateFailures).toEqual([])
  expect(narrowSource.sourceCoordinateFailures).toEqual([])
  expect(wideSource.sourceCoordinatesDigest).not.toBe(narrowSource.sourceCoordinatesDigest)
  const misplaced: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'th',
        properties: { dataSourceLine: 2, dataSourceEndLine: 2 },
        position: content,
        children: [{ type: 'text', value: 'cell' }],
      },
    ],
  }
  expect(digestProjection(wide)).not.toBe(digestProjection(misplaced))
  expect(inspectSourceCorrespondence(misplaced, source).sourceCoordinateFailures).not.toEqual([])
})

test('canonical projection retains whitespace, ordered nesting, list starts and table alignment', () => {
  const text = (value: string): Root => ({ type: 'root', children: [{ type: 'text', value }] })
  expect(digestProjection(text('x\n y'))).not.toBe(digestProjection(text('x y')))
  const structure = (tagName: string, start: number, alignment: string): Root => ({
    type: 'root',
    children: [
      {
        type: 'element',
        tagName,
        properties: { start },
        children: [
          {
            type: 'element',
            tagName: 'td',
            properties: { align: alignment },
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
    ],
  })
  expect(digestProjection(structure('ol', 3, 'right'))).not.toBe(
    digestProjection(structure('ul', 3, 'right')),
  )
  expect(digestProjection(structure('ol', 3, 'right'))).not.toBe(
    digestProjection(structure('ol', 4, 'right')),
  )
  expect(digestProjection(structure('ol', 3, 'right'))).not.toBe(
    digestProjection(structure('ol', 3, 'left')),
  )
  const reversed: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'em',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
    ],
  }
  const original: Root = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'strong',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'em',
            properties: {},
            children: [{ type: 'text', value: 'x' }],
          },
        ],
      },
    ],
  }
  expect(digestProjection(original)).not.toBe(digestProjection(reversed))
})

test('UTF-16 source coordinates are validated separately, including CRLF and generated healing', () => {
  const root: Root = {
    type: 'root',
    children: [
      {
        type: 'text',
        value: 'a',
        position: {
          start: { line: 2, column: 1, offset: 4 },
          end: { line: 2, column: 2, offset: 5 },
        },
      },
    ],
  }
  expect(inspectSourceCorrespondence(root, '😀\r\na').sourceCoordinateFailures).toEqual([])
  expect(inspectSourceCorrespondence(root, '😀\r\n').sourceCoordinateFailures).not.toEqual([])
  const wrongColumn: Root = {
    type: 'root',
    children: [
      {
        type: 'text',
        value: 'a',
        position: {
          start: { line: 2, column: 2, offset: 4 },
          end: { line: 2, column: 2, offset: 5 },
        },
      },
    ],
  }
  expect(inspectSourceCorrespondence(wrongColumn, '😀\r\na').sourceCoordinateFailures).not.toEqual(
    [],
  )
  const healed = runNativeTrial({
    factory: () => createMarkdownSession(),
    engine: 'remark',
    trial: 0,
    workload: {
      id: 'healed-strong',
      source: '**open',
      sourceBytes: 6,
      shape: 'healed-strong',
      family: 'streaming-replay',
      scheduleUnits: 2,
    },
    extensions: { raw: null, math: null },
  })
  expect(healed.revisions.every((revision) => revision.sourceCoordinateFailures.length === 0)).toBe(
    true,
  )
})

test('paired bootstrap rejects regression and intervals crossing the frozen budget', () => {
  const baseline = Array.from({ length: 20 }, () => 10)
  const faster = baseline.map(() => 5)
  const slower = baseline.map(() => 20)
  const ambiguous = baseline.map((_, index) => (index === 19 ? 30 : 10))
  const compare = (candidate: number[]) =>
    pairedConfidence({
      workload: 'control',
      metric: 'updateP95',
      baseline,
      candidate,
      seed: 176,
      resamples: 2048,
    })
  expect(compare(faster)).toMatchObject({ domain: 'native', build: 'source', status: 'passed' })
  expect(compare(slower).status).toBe('failed')
  expect(compare(ambiguous).status).toBe('inconclusive')
  expect(compare(ambiguous)).toEqual(compare(ambiguous))
  expect(
    pairedConfidence({
      workload: 'control',
      metric: 'streamCpu',
      baseline: [10, 10, 10],
      candidate: [1, 1, 1],
      seed: 176,
      resamples: 256,
    }).status,
  ).toBe('inconclusive')
  expect(() => compare(baseline.concat([10]))).toThrow()
  expect(() => compare(baseline.map(() => Number.NaN))).toThrow()
})

test('native projection runs each revision and clears real sessions on release', () => {
  const workload = nativePairWorkloads('quick').find((entry) => entry.id === 'stream-mixed-256/24')
  expect(workload).toBeDefined()
  if (!workload) return
  const owned: ReturnType<typeof createMarkdownSession>[] = []
  const factory = () => {
    const session = createMarkdownSession()
    owned.push(session)
    return session
  }
  const input = { factory, workload, trial: 0, extensions: { raw: null, math: null } }
  const left = runNativeTrial({ ...input, engine: 'remark' })
  const right = runNativeTrial({ ...input, engine: 'tree-sitter' })
  expect(mismatchedRevisions(left.revisions, right.revisions)).toEqual([])
  expect(left.revisions.at(-1)?.phase).toBe('settlement')
  expect(left.revisions.at(-1)?.offset).toBe(workload.source.length)
  expect(left.revisions.some((revision) => revision.reusedBlocks > 0)).toBe(true)
  expect(owned.every((session) => session.update('', { heal: false }).length === 0)).toBe(true)
  expect(left.streamCpuMs).toBeGreaterThanOrEqual(
    left.revisions.reduce((sum, revision) => sum + revision.cpuMs, 0),
  )
})

test('retained old output, skipped revisions and changed coverage fail pair comparison', () => {
  const revision: NativeRevision = {
    revision: 0,
    offset: 10,
    phase: 'update',
    parseMs: 1,
    projectionMs: 1,
    wallMs: 2,
    cpuMs: 2,
    convertedBlocks: 1,
    reusedBlocks: 0,
    outputDigest: 'new',
    sourceCoordinatesDigest: 'coordinates',
    sourceCoordinateFailures: [],
    positionedNodes: 1,
    unchangedProjection: false,
  }
  expect(mismatchedRevisions([revision], [{ ...revision, outputDigest: 'old' }])).toEqual([0])
  expect(mismatchedRevisions([revision], [])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, revision: 1 }])).toEqual([0])
  expect(
    mismatchedRevisions(
      [revision],
      [{ ...revision, sourceCoordinateFailures: ['Invalid source mapping'] }],
    ),
  ).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, offset: 9 }])).toEqual([0])
  expect(mismatchedRevisions([revision], [{ ...revision, phase: 'settlement' }])).toEqual([0])
})

function artifactNativeTrial(engine: NativeTrial['engine'], trial: number): NativeTrial {
  return {
    engine,
    trial,
    mountMs: 2,
    streamCpuMs: 3,
    revisions: [
      {
        revision: 0,
        offset: 1,
        phase: 'update',
        parseMs: 1,
        projectionMs: 1,
        wallMs: 2,
        cpuMs: 2,
        convertedBlocks: 1,
        reusedBlocks: 0,
        outputDigest: 'complete',
        sourceCoordinatesDigest: 'coordinates',
        sourceCoordinateFailures: [],
        positionedNodes: 1,
        unchangedProjection: false,
      },
    ],
  }
}

test('artifact streaming native writes complete pairs in actual order and scalar summaries', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-artifacts-'))
  try {
    const workload = nativePairWorkloads('quick')[0]
    const orders = pairedTrialOrders(2, 176)
    const calls: string[] = []
    const summary = await writeNativePairs({
      output,
      workloads: [workload],
      orders,
      warmups: 1,
      seed: 176,
      mode: 'quick',
      capture: ({ engine, trial }) => {
        if (trial >= 0 && calls.length % 2 === 0) assertNativeWrittenPairs(output, trial)
        calls.push(`${trial}/${engine}`)
        return artifactNativeTrial(engine, trial)
      },
    })
    const raw: unknown[] = (await readFile(path.join(output, summary.pairsArtifact.path), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(raw).toEqual(
      orders.map((order, trial) => ({
        workload: workload.id,
        pair: {
          trial,
          order,
          remark: artifactNativeTrial('remark', trial),
          candidate: artifactNativeTrial('tree-sitter', trial),
          mismatchedRevisions: [],
        },
      })),
    )
    expect(calls).toEqual(
      pairedTrialOrders(1, 176)[0]
        .map((engine) => `-1/${engine}`)
        .concat(orders.flatMap((order, trial) => order.map((engine) => `${trial}/${engine}`))),
    )
    expect(summary.workloads[0]).toMatchObject({ observedPairs: 2, mismatchedPairs: 0 })
    expect(summary.workloads[0]).not.toHaveProperty('pairs')
    expect(summary.workloads[0].comparisons).toEqual(
      (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) =>
        pairedConfidence({
          workload: workload.id,
          metric,
          baseline: metric === 'streamCpu' ? [3, 3] : metric === 'settlementP95' ? [0, 0] : [2, 2],
          candidate: metric === 'streamCpu' ? [3, 3] : metric === 'settlementP95' ? [0, 0] : [2, 2],
          seed: 176,
          resamples: 256,
        }),
      ),
    )
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('artifact streaming native preserves partial first arm and original exception', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-partial-'))
  try {
    const workload = nativePairWorkloads('quick')[0]
    const exception = new TypeError('native second arm failed')
    let count = 0
    const result = writeNativePairs({
      output,
      workloads: [workload],
      orders: pairedTrialOrders(2, 176),
      warmups: 0,
      seed: 176,
      mode: 'quick',
      capture: ({ engine, trial }) => {
        count++
        if (count === 4) throw exception
        return artifactNativeTrial(engine, trial)
      },
    })
    await expect(result).rejects.toBe(exception)
    const completed = (await readFile(path.join(output, 'raw-native-pairs.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
    expect(completed).toHaveLength(1)
    const diagnostic = JSON.parse(
      await readFile(path.join(output, 'native-pair-failure.json'), 'utf8'),
    )
    expect(diagnostic.completed).toEqual([artifactNativeTrial(pairedTrialOrders(2, 176)[1][0], 1)])
    expect(diagnostic.error.message).toBe(exception.message)
    expect(await readdir(output)).not.toContain('paired-native.json')
    expect((await readdir(output)).some((file) => file.startsWith('.timing-'))).toBe(false)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

function assertNativeWrittenPairs(output: string, pairs: number) {
  const temporary = readdirSync(output).find((name) => name.startsWith('.timing-artifact-'))
  if (!temporary) throw new TypeError('Missing native output stream')
  expect(
    readFileSync(path.join(output, temporary, 'partial.jsonl'), 'utf8').split('\n').length - 1,
  ).toBe(pairs)
  expect(readdirSync(output)).not.toContain('raw-native-pairs.jsonl')
}

test('artifact streaming native preserves a failed warmup arm but invents no raw warmups', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-warmup-failure-'))
  try {
    const workload = nativePairWorkloads('quick')[0]
    const error = new TypeError('warmup second arm failed')
    let calls = 0
    await expect(
      writeNativePairs({
        output,
        workloads: [workload],
        orders: pairedTrialOrders(1, 176),
        warmups: 1,
        seed: 176,
        mode: 'quick',
        capture: ({ engine, trial }) => {
          calls++
          if (calls === 2) throw error
          return artifactNativeTrial(engine, trial)
        },
      }),
    ).rejects.toBe(error)
    expect(await readFile(path.join(output, 'raw-native-pairs.jsonl'), 'utf8')).toBe('')
    const diagnostic = JSON.parse(
      await readFile(path.join(output, 'native-pair-failure.json'), 'utf8'),
    )
    expect(diagnostic.trial).toBe(-1)
    expect(diagnostic.completed).toHaveLength(1)
    expect(diagnostic.pairsArtifact.recordCount).toBe(0)
    expect(calls).toBe(2)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('artifact streaming native keeps mismatch counts and every failed revision fact', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-mismatch-'))
  try {
    const workload = nativePairWorkloads('quick')[0]
    const summary = await writeNativePairs({
      output,
      workloads: [workload],
      orders: pairedTrialOrders(1, 176),
      warmups: 0,
      seed: 176,
      mode: 'qualification',
      capture: ({ engine, trial }) => {
        const raw = artifactNativeTrial(engine, trial)
        return engine === 'remark'
          ? raw
          : {
              ...raw,
              revisions: raw.revisions.map((revision) => ({
                ...revision,
                sourceCoordinateFailures: ['bad coordinate'],
                outputDigest: 'changed',
              })),
            }
      },
    })
    expect(summary.workloads[0].mismatchedPairs).toBe(1)
    expect(summary.workloads[0].observedPairs).toBe(1)
    expect(summary.workloads[0].comparisons.every((entry) => entry.resamples === 4096)).toBe(true)
    const raw = JSON.parse(await readFile(path.join(output, summary.pairsArtifact.path), 'utf8'))
    expect(raw.pair.mismatchedRevisions).toEqual([0])
    expect(raw.pair.candidate.revisions[0].sourceCoordinateFailures).toEqual(['bad coordinate'])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('scalar observations native frozen population remains 75 workloads and 1500 complete pairs', () => {
  expect(nativePairWorkloads('qualification')).toHaveLength(75)
  expect(pairedTrialOrders(20, 176)).toHaveLength(20)
  expect(75 * 20).toBe(1500)
  expect(75 * 20 * 2).toBe(3000)
})

function nativeArtifactOptions(output: string) {
  return {
    output,
    workloads: [nativePairWorkloads('quick')[0]],
    orders: pairedTrialOrders(1, 176),
    warmups: 0,
    seed: 176,
    mode: 'quick' as const,
  }
}

test.each(['raw-native-pairs.jsonl', 'paired-native.json'])(
  'native publication rejects existing %s before any capture',
  async (file) => {
    const output = await mkdtemp(path.join(tmpdir(), 'native-owned-'))
    try {
      await writeFile(path.join(output, file), 'owner bytes\n')
      const calls: string[] = []
      await expect(
        writeNativePairs({
          ...nativeArtifactOptions(output),
          capture: ({ engine, trial }) => {
            calls.push(engine)
            return artifactNativeTrial(engine, trial)
          },
        }),
      ).rejects.toThrow()
      expect(calls).toEqual([])
      expect(await readFile(path.join(output, file), 'utf8')).toBe('owner bytes\n')
      expect(await readdir(output)).toEqual([file])
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test.each([false, true])(
  'native publication preserves destination symlink, dangling=%s',
  async (dangling) => {
    const output = await mkdtemp(path.join(tmpdir(), 'native-symlink-'))
    try {
      const owner = path.join(output, 'owner')
      if (!dangling) await writeFile(owner, 'owner bytes\n')
      await symlink(owner, path.join(output, 'paired-native.json'))
      const calls: string[] = []
      await expect(
        writeNativePairs({
          ...nativeArtifactOptions(output),
          capture: ({ engine, trial }) => {
            calls.push(engine)
            return artifactNativeTrial(engine, trial)
          },
        }),
      ).rejects.toThrow()
      expect(calls).toEqual([])
      await expect(publishNativeReport(output, { status: 'fixture' })).rejects.toThrow()
      expect((await lstat(path.join(output, 'paired-native.json'))).isSymbolicLink()).toBe(true)
      if (!dangling) expect(await readFile(owner, 'utf8')).toBe('owner bytes\n')
      if (dangling) await expect(lstat(owner)).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('native publication refuses a late existing envelope without overwriting it', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-envelope-'))
  try {
    await writeFile(path.join(output, 'paired-native.json'), 'owner envelope\n')
    await expect(publishNativeReport(output, { status: 'fixture' })).rejects.toThrow()
    expect(await readFile(path.join(output, 'paired-native.json'), 'utf8')).toBe('owner envelope\n')
    expect(await readdir(output)).toEqual(['paired-native.json'])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('native publication capture exception survives raw seal failure with first-arm diagnostic', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-double-failure-'))
  try {
    const exception = new TypeError('capture failed before raw seal collision')
    const order = pairedTrialOrders(1, 176)[0]
    let calls = 0
    await expect(
      writeNativePairs({
        ...nativeArtifactOptions(output),
        capture: ({ engine, trial }) => {
          calls++
          if (calls === 1) return artifactNativeTrial(engine, trial)
          writeFileSync(path.join(output, 'raw-native-pairs.jsonl'), 'late owner bytes\n')
          throw exception
        },
      }),
    ).rejects.toBe(exception)
    expect(calls).toBe(2)
    const diagnostic = JSON.parse(
      await readFile(path.join(output, 'native-pair-failure.json'), 'utf8'),
    )
    expect(diagnostic.completed).toEqual([artifactNativeTrial(order[0], 0)])
    expect(diagnostic.error.message).toBe(exception.message)
    expect(diagnostic).not.toHaveProperty('pairsArtifact')
    expect(await readFile(path.join(output, 'raw-native-pairs.jsonl'), 'utf8')).toBe(
      'late owner bytes\n',
    )
    expect((await readdir(output)).sort()).toEqual([
      'native-pair-failure.json',
      'raw-native-pairs.jsonl',
    ])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test.each([false, true])(
  'native publication preserves capture identity when diagnostics fail, sealFailure=%s',
  async (sealFailure) => {
    const output = await mkdtemp(path.join(tmpdir(), 'native-diagnostic-failure-'))
    try {
      const exception = new TypeError('capture and diagnostic failed')
      let calls = 0
      await expect(
        writeNativePairs({
          ...nativeArtifactOptions(output),
          capture: ({ engine, trial }) => {
            calls++
            if (calls === 1) return artifactNativeTrial(engine, trial)
            mkdirSync(path.join(output, 'native-pair-failure.json'))
            if (sealFailure)
              writeFileSync(path.join(output, 'raw-native-pairs.jsonl'), 'late owner bytes\n')
            throw exception
          },
        }),
      ).rejects.toBe(exception)
      expect(calls).toBe(2)
      expect((await lstat(path.join(output, 'native-pair-failure.json'))).isDirectory()).toBe(true)
      expect((await readdir(output)).sort()).toEqual([
        'native-pair-failure.json',
        'raw-native-pairs.jsonl',
      ])
    } finally {
      await rm(output, { recursive: true, force: true })
    }
  },
)

test('native publication propagates raw I/O error when capture succeeds', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-io-failure-'))
  try {
    let calls = 0
    await expect(
      writeNativePairs({
        ...nativeArtifactOptions(output),
        capture: ({ engine, trial }) => {
          calls++
          writeFileSync(path.join(output, 'raw-native-pairs.jsonl'), 'late owner bytes\n')
          return artifactNativeTrial(engine, trial)
        },
      }),
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(calls).toBe(2)
    expect(await readdir(output)).toEqual(['raw-native-pairs.jsonl'])
    expect(await readFile(path.join(output, 'raw-native-pairs.jsonl'), 'utf8')).toBe(
      'late owner bytes\n',
    )
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('native publication publishes complete envelope after raw seal and removes temporary files', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-published-'))
  try {
    const observed = await writeNativePairs({
      ...nativeArtifactOptions(output),
      capture: ({ engine, trial }) => artifactNativeTrial(engine, trial),
    })
    const report = {
      schemaVersion: 2,
      pairsArtifact: observed.pairsArtifact,
      workloads: observed.workloads,
    }
    expect(await readdir(output)).toEqual(['raw-native-pairs.jsonl'])
    await publishNativeReport(output, report)
    expect(JSON.parse(await readFile(path.join(output, 'paired-native.json'), 'utf8'))).toEqual(
      report,
    )
    expect((await readdir(output)).sort()).toEqual(['paired-native.json', 'raw-native-pairs.jsonl'])
    const raw = await readFile(path.join(output, observed.pairsArtifact.path))
    expect(raw.byteLength).toBe(observed.pairsArtifact.byteLength)
    expect(raw.toString().split('\n')).toHaveLength(2)
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})

test('native publication exposes no partial envelope when serialization fails', async () => {
  const output = await mkdtemp(path.join(tmpdir(), 'native-unpublished-'))
  try {
    const exception = new TypeError('envelope serialization failed')
    await expect(
      publishNativeReport(output, {
        toJSON() {
          expect(readdirSync(output)).not.toContain('paired-native.json')
          throw exception
        },
      }),
    ).rejects.toBe(exception)
    expect(await readdir(output)).toEqual([])
  } finally {
    await rm(output, { recursive: true, force: true })
  }
})
