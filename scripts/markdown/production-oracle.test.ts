import { mkdtemp, readFile, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { expect, test } from 'vitest'
import {
  oracleCallbackRecords,
  retainPairedOracleMismatch,
  retainTimingOracleMismatch,
  parseProductionOracleRecord,
  oracleIdentity,
  reconcileProductionOracles,
  writeProductionOracle,
  type ProductionOracleRecord,
} from './production-oracle'
import { hashFile } from './timing-artifacts'
import { validateRevisionReceipts, type ProductionTrial } from './production-analysis'
import type { ProductionMarkdownFrame } from '../../apps/web/test/factories/markdown-production-types'

function frame(text: string, revision: number): ProductionMarkdownFrame {
  const projection = { text, elements: [{ tag: 'p', text, parents: [], attributes: {} }] }
  const output = {
    digest: hash(JSON.stringify(projection)),
    textBytes: Buffer.byteLength(text),
    elementCount: 1,
  }
  return {
    ...projection,
    revision,
    observedRevision: revision,
    inputSha256: hash(text),
    inputUtf16Units: text.length,
    live: revision === 1,
    scheduled: revision,
    received: revision,
    committed: revision + 1,
    painted: revision + 2,
    parseCalls: revision,
    parserWallMs: 0.5,
    output,
    paintedOutput: output,
  }
}
function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
async function* records(): AsyncGenerator<ProductionOracleRecord> {
  yield { kind: 'frame', frame: frame('A', 1) }
  yield { kind: 'frame', frame: frame('AB', 2) }
  yield { kind: 'final', frame: frame('AB', 2), fullyReady: 4, longTasks: [1], resources: [] }
  yield { kind: 'fresh', frame: { ...frame('AB', 3), live: false } }
}
async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'oracle-spill-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
test('oracle spill preserves full ordered records and returns only compact frame identities', async () => {
  await fixture(async (root) => {
    const captured = await writeProductionOracle({ root, file: 'oracle.jsonl', records: records() })
    const actual = (await readFile(path.join(root, 'oracle.jsonl'), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    const expected = []
    for await (const record of records()) expected.push(record)
    expect(actual).toEqual(expected)
    expect(captured.correctness.frames).toEqual([
      oracleIdentity(frame('A', 1)),
      oracleIdentity(frame('AB', 2)),
    ])
    expect(JSON.stringify(captured)).not.toContain('"elements"')
    await reconcileProductionOracles({
      root,
      first: captured,
      second: captured,
      inputs: ['A', 'AB'],
    })
  })
})
for (const mutation of [
  'missing-frame',
  'reordered',
  'changed-frame',
  'missing-final',
  'changed-final',
  'missing-fresh',
  'changed-fresh',
] as const) {
  test(`oracle spill rejects ${mutation} after actual artifact rehash`, async () => {
    await fixture(async (root) => {
      const captured = await writeProductionOracle({
        root,
        file: 'oracle.jsonl',
        records: records(),
      })
      const rows = (await readFile(path.join(root, 'oracle.jsonl'), 'utf8'))
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      if (mutation === 'missing-frame') rows.splice(0, 1)
      if (mutation === 'reordered') rows.reverse()
      if (mutation === 'changed-frame') rows[0].frame.text = 'wrong'
      if (mutation === 'missing-final') rows.splice(2, 1)
      if (mutation === 'changed-final') rows[2].frame.text = 'wrong'
      if (mutation === 'missing-fresh') rows.splice(3, 1)
      if (mutation === 'changed-fresh') rows[3].frame.elements = []
      await writeFile(
        path.join(root, 'oracle.jsonl'),
        rows.map((row) => JSON.stringify(row)).join('\n') + '\n',
      )
      const artifact = {
        ...(await hashFile({ root, file: 'oracle.jsonl' })),
        recordCount: rows.length,
      }
      const changed = { ...captured, correctness: { ...captured.correctness, artifact } }
      await expect(
        reconcileProductionOracles({ root, first: changed, second: changed, inputs: ['A', 'AB'] }),
      ).rejects.toThrow()
    })
  })
}

for (const invalidOrder of ['duplicate-final', 'early-fresh', 'missing-fresh'] as const) {
  test(`invalid oracle ${invalidOrder} never seals its artifact`, async () => {
    await fixture(async (root) => {
      await expect(
        writeProductionOracle({
          root,
          file: 'invalid.jsonl',
          records: invalidRecords(invalidOrder),
        }),
      ).rejects.toThrow()
      await expect(access(path.join(root, 'invalid.jsonl'))).rejects.toThrow()
    })
  })
}
test('oracle callback channel holds one frame and closes an aborted producer', async () => {
  const state = { emitted: 0, released: 0, stopped: false }
  const channel = oracleCallbackRecords((emit) => pumpRecords(emit, state))
  expect((await channel.next()).done).toBe(false)
  expect([state.emitted, state.released]).toEqual([1, 0])
  expect((await channel.next()).done).toBe(false)
  expect([state.emitted, state.released]).toEqual([2, 1])
  await channel.return(undefined)
  expect([state.emitted, state.released, state.stopped]).toEqual([2, 1, true])
})
test('oracle callback producer errors propagate without a completion fallback', async () => {
  const channel = oracleCallbackRecords(async (emit) => {
    await emit({ kind: 'frame', frame: frame('A', 1) })
    throw new Error('actual producer failure')
  })
  await channel.next()
  await expect(channel.next()).rejects.toThrow('actual producer failure')
})

test('oracle record validation preserves the original frame and projection array', () => {
  const record = { kind: 'frame', frame: frame('A', 1) } as const
  const actual = parseProductionOracleRecord(record)
  expect(actual).toBe(record)
  expect(actual.frame.elements).toBe(record.frame.elements)
  expect(() =>
    parseProductionOracleRecord({
      ...record,
      frame: { ...record.frame, elements: [{ tag: 'p', text: 2, attributes: {} }] },
    }),
  ).toThrow()
})
test('oracle reader reaches EOF and rejects a late original-file hash mismatch', async () => {
  await fixture(async (root) => {
    const captured = await writeProductionOracle({ root, file: 'oracle.jsonl', records: records() })
    const contents = await readFile(path.join(root, 'oracle.jsonl'), 'utf8')
    await writeFile(
      path.join(root, 'oracle.jsonl'),
      contents.replace('"kind":"fresh"', '"kind": "fresh"'),
    )
    await expect(
      reconcileProductionOracles({ root, first: captured, second: captured, inputs: ['A', 'AB'] }),
    ).rejects.toThrow('SHA256')
  })
})

test('independent lockstep comparison rejects individually valid but different projections', async () => {
  await fixture(async (root) => {
    const first = await writeProductionOracle({ root, file: 'first.jsonl', records: records() })
    const second = await writeProductionOracle({
      root,
      file: 'second.jsonl',
      records: changedRecords(),
    })
    await expect(
      reconcileProductionOracles({ root, first, second, inputs: ['A', 'AB'] }),
    ).rejects.toThrow('paired projection differs')
  })
})

async function* invalidRecords(invalidOrder: string): AsyncGenerator<ProductionOracleRecord> {
  for await (const record of records()) {
    if (invalidOrder === 'early-fresh' && record.kind === 'frame')
      yield { kind: 'fresh', frame: record.frame }
    if (invalidOrder === 'missing-fresh' && record.kind === 'fresh') continue
    yield record
    if (invalidOrder === 'duplicate-final' && record.kind === 'final') yield record
  }
}
async function pumpRecords(
  emit: (record: ProductionOracleRecord) => Promise<void>,
  state: { emitted: number; released: number; stopped: boolean },
) {
  try {
    for await (const record of records()) {
      state.emitted++
      await emit(record)
      state.released++
    }
  } finally {
    state.stopped = true
  }
}
async function* changedRecords(): AsyncGenerator<ProductionOracleRecord> {
  for await (const record of records()) {
    const observed = frame('other', record.frame.revision)
    yield {
      ...record,
      frame: {
        ...record.frame,
        text: observed.text,
        elements: observed.elements,
        output: observed.output,
        paintedOutput: observed.paintedOutput,
      },
    }
  }
}

test('fresh mismatch retains a bounded witness before compacting the fresh identity', async () => {
  await fixture(async (root) => {
    const captured = await writeProductionOracle({
      root,
      file: 'oracle.jsonl',
      engine: 'remark',
      records: freshMismatchRecords(),
    })
    const witness = JSON.parse(
      await readFile(path.join(root, 'oracle.jsonl.mismatch.json'), 'utf8'),
    )
    expect(witness.actual).toMatchObject({ engine: 'remark', revision: 3, inputSha256: hash('AB') })
    expect(witness.capture).toEqual({
      state: 'eof-verified',
      artifacts: [captured.correctness.artifact],
    })
    expect(await hashFile({ root, file: 'oracle.jsonl' })).toEqual({
      path: captured.correctness.artifact.path,
      sha256: captured.correctness.artifact.sha256,
      byteLength: captured.correctness.artifact.byteLength,
    })
    await expect(
      access(path.join(root, 'oracle.jsonl.mismatch.provisional.json')),
    ).rejects.toThrow()
    expect(witness.firstDifference).toMatchObject({
      path: '$.text',
      actual: { present: true },
      expected: { present: true },
    })
    expect(captured.freshCompleted.paintedOutput.digest).not.toBe(
      captured.correctness.final.paintedOutput.digest,
    )
    await expect(
      reconcileProductionOracles({ root, first: captured, second: captured, inputs: ['A', 'AB'] }),
    ).rejects.toThrow('fresh completion differs')
  })
})

test('paired mismatch retains its first bounded pair and releases both backpressured readers', async () => {
  await fixture(async (root) => {
    const first = await writeProductionOracle({ root, file: 'first.jsonl', records: records() })
    const second = await writeProductionOracle({
      root,
      file: 'second.jsonl',
      records: changedRecords(),
    })
    expect(
      await retainPairedOracleMismatch({
        root,
        file: 'pair.json',
        first: { ...first, engine: 'remark' },
        second: { ...second, engine: 'tree-sitter' },
      }),
    ).toBe(true)
    const text = await readFile(path.join(root, 'pair.json'), 'utf8')
    const witness = JSON.parse(text)
    expect(witness.actual).toMatchObject({ engine: 'tree-sitter', revision: 1 })
    expect(witness.expected).toMatchObject({ engine: 'remark', revision: 1 })
    expect(witness.firstDifference.path).toBe('$.text')
    expect(Buffer.byteLength(text)).toBeLessThanOrEqual(witness.limits.maxJsonBytes)
    await expect(
      reconcileProductionOracles({ root, first, second, inputs: ['A', 'AB'] }),
    ).rejects.toThrow('paired projection differs')
  })
})

async function* freshMismatchRecords(): AsyncGenerator<ProductionOracleRecord> {
  for await (const record of records()) {
    if (record.kind !== 'fresh') {
      yield record
      continue
    }
    const changed = frame('other', 3)
    yield {
      ...record,
      frame: {
        ...record.frame,
        text: changed.text,
        elements: changed.elements,
        output: changed.output,
        paintedOutput: changed.paintedOutput,
      },
    }
  }
}

test('timing mismatch joins its actual observation to a rehashed independent expected record', async () => {
  await fixture(async (root) => {
    const captured = await writeProductionOracle({ root, file: 'oracle.jsonl', records: records() })
    const expected = frame('A', 1)
    const changed = frame('changed', 1)
    const actual = { ...changed, inputSha256: expected.inputSha256, inputUtf16Units: 1 }
    await retainTimingOracleMismatch({
      root,
      file: 'timing.json',
      engine: 'tree-sitter',
      oracle: captured.correctness,
      sample: { actual, expected: expected.paintedOutput, expectedIndex: 0 },
    })
    const witness = JSON.parse(await readFile(path.join(root, 'timing.json'), 'utf8'))
    expect(witness.actual).toMatchObject({
      engine: 'tree-sitter',
      revision: 1,
      inputSha256: hash('A'),
    })
    expect(witness.expected.observation.preview).toContain('"text":"A"')
    expect(witness.firstDifference.path).toBe('$.text')
    expect(witness.verdict).toBe('mismatch')
  })
})

test('paired witness drains to verified EOF and does not seal evidence from a changed artifact', async () => {
  await fixture(async (root) => {
    const first = await writeProductionOracle({ root, file: 'first.jsonl', records: records() })
    const second = await writeProductionOracle({
      root,
      file: 'second.jsonl',
      records: changedRecords(),
    })
    const contents = await readFile(path.join(root, 'second.jsonl'), 'utf8')
    await writeFile(
      path.join(root, 'second.jsonl'),
      contents.replace('"kind":"fresh"', '"kind": "fresh"'),
    )
    await expect(
      retainPairedOracleMismatch({
        root,
        file: 'pair.json',
        first: { ...first, engine: 'remark' },
        second: { ...second, engine: 'tree-sitter' },
      }),
    ).rejects.toThrow('SHA256')
    await expect(access(path.join(root, 'pair.json'))).rejects.toThrow()
  })
})

async function* repeatedRecords(): AsyncGenerator<ProductionOracleRecord> {
  yield { kind: 'frame', frame: frame('A', 1) }
  yield { kind: 'frame', frame: frame('A', 2) }
  yield { kind: 'final', frame: frame('A', 2), fullyReady: 4, longTasks: [], resources: [] }
  yield { kind: 'fresh', frame: frame('A', 3) }
}

test('repeated live and completed input selects the exact scheduled expectation', async () => {
  await fixture(async (root) => {
    const captured = await writeProductionOracle({
      root,
      file: 'oracle.jsonl',
      records: repeatedRecords(),
    })
    await reconcileProductionOracles({
      root,
      first: captured,
      second: captured,
      inputs: ['A', 'A'],
    })
    const actual = { ...frame('B', 19), inputSha256: hash('A'), observedRevision: 20, live: false }
    await retainTimingOracleMismatch({
      root,
      file: 'timing.json',
      engine: 'remark',
      oracle: captured.correctness,
      sample: { actual, expected: captured.correctness.frames[1].paintedOutput, expectedIndex: 1 },
    })
    const witness = JSON.parse(await readFile(path.join(root, 'timing.json'), 'utf8'))
    expect(witness.expected).toMatchObject({ revision: 2, observedRevision: 2, live: false })
    expect(witness.actual).toMatchObject({ revision: 19, observedRevision: 20, live: false })
    expect(witness.capture).toEqual({
      state: 'eof-verified',
      artifacts: [captured.correctness.artifact],
    })
  })
})

async function* failedFreshRecords(
  failure: 'false' | 'undefined' | 'validation',
): AsyncGenerator<ProductionOracleRecord> {
  yield* freshMismatchRecords()
  if (failure === 'false') throw false
  if (failure === 'undefined') throw undefined
  yield { kind: 'frame', frame: frame('late', 4) }
}
type FreshFailure = 'false' | 'undefined' | 'validation' | 'writer'

async function assertProvisionalFreshFailure(root: string, failure: FreshFailure) {
  if (failure === 'writer') await writeFile(path.join(root, 'oracle.jsonl'), 'occupied')
  const writing = writeProductionOracle({
    root,
    file: 'oracle.jsonl',
    records: failure === 'writer' ? freshMismatchRecords() : failedFreshRecords(failure),
  })
  if (failure === 'false') await expect(writing).rejects.toBe(false)
  if (failure === 'undefined') await expect(writing).rejects.toBeUndefined()
  if (failure === 'validation' || failure === 'writer') await expect(writing).rejects.toThrow()
  await expect(access(path.join(root, 'oracle.jsonl.mismatch.json'))).rejects.toThrow()
  const witness = JSON.parse(
    await readFile(path.join(root, 'oracle.jsonl.mismatch.provisional.json'), 'utf8'),
  )
  expect(witness.capture).toEqual({ state: 'provisional' })
  expect(witness.verdict).toBe('mismatch')
  expect(witness.firstDifference.path).toBe('$.text')
  if (failure !== 'writer') await expect(access(path.join(root, 'oracle.jsonl'))).rejects.toThrow()
  if (failure === 'writer')
    expect(await readFile(path.join(root, 'oracle.jsonl'), 'utf8')).toBe('occupied')
}

for (const failure of ['false', 'undefined', 'validation', 'writer'] as const) {
  test(`fresh mismatch stays provisional after ${failure} failure`, async () => {
    await fixture((root) => assertProvisionalFreshFailure(root, failure))
  })
}

for (const reason of [false, undefined]) {
  test(`oracle callback preserves producer rejection ${String(reason)}`, async () => {
    const channel = oracleCallbackRecords(async (emit) => {
      await emit({ kind: 'frame', frame: frame('A', 1) })
      throw reason
    })
    await channel.next()
    await expect(channel.next()).rejects.toBe(reason)
  })
}

test('equal-output superseded revision remains a strict analyzer failure', async () => {
  await fixture(async (root) => {
    const captured = await writeProductionOracle({
      root,
      file: 'oracle.jsonl',
      records: repeatedRecords(),
    })
    const first = frame('A', 1)
    const final = frame('A', 2)
    const trial: ProductionTrial = {
      workload: 'repeated-input',
      family: 'warm-completed',
      pair: 0,
      order: 'AB',
      engine: 'remark',
      arrival: 'paced',
      cache: 'warm',
      navigationMs: 0,
      initializationMs: 0,
      environment: {
        userAgent: 'fixture',
        concurrency: 1,
        deviceScaleFactor: 1,
        viewport: { width: 100, height: 100 },
        fontFamily: 'sans-serif',
        fonts: [],
      },
      receipt: {
        started: 0,
        ended: 5,
        processed: [first, final],
        skippedPaintRevisions: [],
        frames: [first, final],
        final,
        fullyReady: 5,
        fullyReadyOutput: final.paintedOutput,
        heldSyntax: null,
        longTasks: [],
        resources: [],
      },
      correctness: captured.correctness,
      freshCompleted: captured.freshCompleted,
      cpu: null,
      updateCpu: [],
      workers: null,
      network: null,
      streamMainThreadCpuMs: null,
      workerCpu: null,
      timeline: null,
      resourceWindows: null,
      resourceControlWindows: null,
    }
    expect(validateRevisionReceipts(trial, ['A', 'A'])).toEqual([])
    const superseded = { ...first, observedRevision: 2 }
    expect(
      validateRevisionReceipts(
        { ...trial, receipt: { ...trial.receipt, frames: [superseded, final] } },
        ['A', 'A'],
      ),
    ).toEqual(['remark: paint receipt 1 does not match its expected projection.'])
  })
})
