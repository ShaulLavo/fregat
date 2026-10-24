import { hash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { PROMOTION_GATES } from './promotion'
import { digestProjection } from './paired-native'
import { createScriptError } from '../structured-errors'
import { expect, test } from 'vitest'
import {
  type CheckRun,
  checkRunExitCode,
  qualificationExitCode,
  validateChecksOnly,
} from './check-exit'
import {
  seededEdits,
  collectFuzzSchedule,
  observeFuzzRevision,
  pairedNativeTestRun,
  runSeededFuzz,
  qualificationTestPlan,
  captureQualificationArtifacts,
  qualificationSourceContext,
  parseTestCounts,
  readTestResult,
  verifyQualificationArtifactBindings,
} from './qualify'

const passed: CheckRun = { exitCode: 0, tests: 2, passed: 2, failed: 0 }
const executed = {
  checksOnly: true,
  mode: 'paired',
  candidateAvailable: true,
  verdict: 'NOT VERIFIED',
  runs: [passed],
  expectedRuns: 1,
} as const

test('checks-only success leaves promotion unqualified and the default exit nonzero', () => {
  expect(qualificationExitCode(executed)).toBe(0)
  expect(qualificationExitCode({ ...executed, checksOnly: false })).toBe(1)
  expect(qualificationExitCode({ ...executed, checksOnly: false, verdict: 'INCONCLUSIVE' })).toBe(1)
  expect(executed.verdict).toBe('NOT VERIFIED')
  expect(PROMOTION_GATES).toHaveLength(14)
})

test('absent candidate, failing suite, missing report, empty run and missing planned suite fail checks', () => {
  expect(qualificationExitCode({ ...executed, candidateAvailable: false })).toBe(1)
  expect(qualificationExitCode({ ...executed, mode: 'baseline' })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [{ ...passed, exitCode: 1 }] })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [{ ...passed, failed: 1 }] })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [{ ...passed, tests: 0, passed: 0 }] })).toBe(1)
  expect(qualificationExitCode({ ...executed, runs: [] })).toBe(1)
  expect(qualificationExitCode({ ...executed, expectedRuns: 2 })).toBe(1)
  expect(checkRunExitCode(0, { tests: 10, passed: 0, failed: 0 })).toBe(1)
})

test.each([
  { baseline: true },
  { inspectOnly: true },
  { receipts: 'receipts.json' },
  { evaluationReceipt: 'evaluation.json' },
  { evaluationLedger: 'ledger' },
])('checks-only refuses certification or non-execution arguments %j', (argument) => {
  expect(() => validateChecksOnly({ checksOnly: true, ...argument })).toThrow()
})

test('nightly plans pair actual engines, include seeded package streaming, and choose WebKit explicitly', () => {
  const stream = qualificationTestPlan('stream', 'paired')
  expect(stream).toHaveLength(4)
  const parity = qualificationTestPlan('parity', 'paired')
  expect(parity).toHaveLength(4)
  expect(parity[1].flags).toEqual(
    expect.arrayContaining([
      'qualification-semantics',
      'qualification-state',
      'qualification-layout',
      'qualification-production',
    ]),
  )
  expect(stream[0].flags).toContain('qualification-stream')
  expect(stream[2].flags).toContain('qualification-candidate')
  expect(qualificationTestPlan('visual', 'paired', 'webkit').map((entry) => entry.flags)).toEqual([
    expect.arrayContaining(['--mode', 'baseline-webkit']),
    expect.arrayContaining(['--mode', 'candidate-webkit']),
  ])
})

test('seeded fuzz edits replay exactly, retain undo and delimiters, and bound source growth', () => {
  const edits = seededEdits(176, 64)
  expect(edits).toEqual(seededEdits(176, 64))
  expect(edits).toHaveLength(65)
  expect(edits.some((entry) => entry.operation === 'undo')).toBe(true)
  expect(edits.some((entry) => entry.operation.startsWith('delete'))).toBe(true)
  expect(edits.some((entry) => entry.operation.startsWith('insert'))).toBe(true)
  expect(edits.every((entry) => entry.source.length < 4200)).toBe(true)
})

test('full development schedule accounts every revision with matching real engines', async () => {
  const report = await runSeededFuzz(true, 2, 64)
  expect(report.cases).toHaveLength(4)
  expect(report.failures).toBe(0)
  expect(report.verdict).toBe('NOT VERIFIED')
  expect(report.cases.map(({ seed, live }) => ({ seed, live }))).toEqual([
    { seed: 176, live: false },
    { seed: 176, live: true },
    { seed: 177, live: false },
    { seed: 177, live: true },
  ])
  expect(report).toMatchObject({
    seeds: 2,
    operationsPerSeed: 64,
    maxSourceUnits: 4120,
    declaredRevisions: 260,
    executedRevisions: 260,
    unexecutedRevisions: 0,
    pairedComparisons: 260,
    parseChecks: {
      remark: { attempted: 520, parsed: 520, exceptions: 0, incrementalFreshComparisons: 260 },
      candidate: { attempted: 520, parsed: 520, exceptions: 0, incrementalFreshComparisons: 260 },
    },
  })
  const observations = report.cases.flatMap((entry) => entry.observations)
  expect(report.rawFailedRevisions).toBe(
    observations.filter((entry) => entry.failures.length > 0).length,
  )
  expect(report.rawFailedRevisions).toBe(0)
  expect(report.rawFailures).toBe(observations.flatMap((entry) => entry.failures).length)
  expect(
    checkRunExitCode(0, {
      tests: report.cases.length,
      passed: report.cases.length - report.failures,
      failed: report.failures,
    }),
  ).toBe(0)
  for (const entry of report.cases) {
    expect(entry.declaredRevisions).toBe(65)
    expect(entry.executedRevisions).toBe(entry.declaredRevisions)
    expect(entry.unexecutedRevisions).toBe(0)
    expect(entry.failure).toBeNull()
    expect(entry.replay).toEqual([])
  }
})

test('full development schedule continues after controlled paired mismatches and stays red', () => {
  const edits = seededEdits(176, 64)
  const report = collectFuzzSchedule(edits, (edit, revision) => {
    const baseline = observationRoot(edit.source)
    const candidate = observationRoot(revision === 1 || revision === 5 ? 'changed' : edit.source)
    return observeFuzzRevision({
      edit,
      live: false,
      revision,
      remark: { incremental: () => baseline, fresh: () => baseline },
      candidate: { incremental: () => candidate, fresh: () => candidate },
    })
  })
  expect(report).toMatchObject({
    declaredRevisions: 65,
    executedRevisions: 65,
    unexecutedRevisions: 0,
    failure: { kind: 'mismatch', engine: 'paired', revision: 1 },
  })
  expect(report.observations.map((entry) => entry.source)).toEqual(edits.map((edit) => edit.source))
  expect(report.failures.map((entry) => entry.revision)).toEqual([1, 5])
  expect(report.replay).toEqual(edits.slice(0, 2))
  expect(report.failure?.expected).not.toBe(report.failure?.observed)
  expect(
    checkRunExitCode(0, {
      tests: report.declaredRevisions,
      passed: report.executedRevisions - report.failures.length,
      failed: report.failures.length,
    }),
  ).toBe(1)
})

test('full development schedule retains deterministic original UTF-16 identities and accounting', async () => {
  const first = await runSeededFuzz(true, 1, 8)
  const replay = await runSeededFuzz(true, 1, 8)
  expect(first).toEqual(replay)
  expect(first).toMatchObject({
    declaredRevisions: 18,
    executedRevisions: 18,
    unexecutedRevisions: 0,
  })
  for (const entry of first.cases) {
    const edits = seededEdits(entry.seed, 8)
    expect(entry.observations.map((observation) => observation.source)).toEqual(
      edits.map((edit) => edit.source),
    )
    expect(entry.scheduleSha256).toBe(hash('sha256', JSON.stringify(edits), 'hex'))
    for (const observation of entry.observations) {
      expect(observation.sourceIdentity).toEqual({
        utf16Units: observation.source.length,
        utf16LeSha256: hash('sha256', Buffer.from(observation.source, 'utf16le'), 'hex'),
        sourceJsonSha256: hash('sha256', JSON.stringify(observation.source), 'hex'),
      })
      expect(observation.remark.incremental.kind).toBe('parsed')
      expect(observation.remark.fresh.kind).toBe('parsed')
      expect(observation.candidate?.incremental.kind).toBe('parsed')
      expect(observation.candidate?.fresh.kind).toBe('parsed')
    }
  }
})

function observationRoot(value: string): Parameters<typeof digestProjection>[0] {
  return { type: 'root', children: [{ type: 'text', value }] }
}

test('development observation collects both independent drifts and paired mismatch before classification', () => {
  const reads: string[] = []
  const read = (name: string) => {
    reads.push(name)
    return observationRoot(name)
  }
  const observation = observeFuzzRevision({
    edit: { source: '\ud800🧑‍💻\r\n', operation: 'initial' },
    live: true,
    revision: 4,
    remark: {
      incremental: () => read('remark-incremental'),
      fresh: () => read('remark-fresh'),
    },
    candidate: {
      incremental: () => read('candidate-incremental'),
      fresh: () => read('candidate-fresh'),
    },
  })
  expect(reads).toEqual([
    'remark-incremental',
    'remark-fresh',
    'candidate-incremental',
    'candidate-fresh',
  ])
  expect(observation.failures.map((failure) => failure.engine)).toEqual([
    'remark',
    'tree-sitter',
    'paired',
  ])
  expect(observation.failures.every((failure) => failure.kind === 'mismatch')).toBe(true)
  expect(observation.sourceIdentity.utf16LeSha256).not.toBe(
    hash('sha256', Buffer.from('�🧑‍💻\r\n', 'utf16le'), 'hex'),
  )
  expect(JSON.parse(JSON.stringify(observation))).toEqual(observation)
  for (const engine of [observation.remark, observation.candidate]) {
    expect(engine).not.toBeNull()
    if (!engine) continue
    for (const parse of [engine.incremental, engine.fresh]) {
      expect(parse.kind).toBe('parsed')
      if (parse.kind !== 'parsed') continue
      expect(parse.outputDigest).toBe(digestProjection(parse.hast))
    }
  }
})

test('development observation retains changed published source lines in the strict paired failure', () => {
  const baseline: Parameters<typeof digestProjection>[0] = {
    type: 'root',
    children: [
      {
        type: 'element',
        tagName: 'p',
        properties: { dataSourceLine: 1, dataSourceEndLine: 1 },
        children: [{ type: 'text', value: 'same text' }],
      },
    ],
  }
  const candidate = structuredClone(baseline)
  const element = candidate.children[0]
  if (element.type === 'element') element.properties.dataSourceEndLine = 2
  const observation = observeFuzzRevision({
    edit: { source: 'same text', operation: 'initial' },
    live: false,
    revision: 0,
    remark: { incremental: () => baseline, fresh: () => baseline },
    candidate: { incremental: () => candidate, fresh: () => candidate },
  })
  expect(observation.failures).toEqual([
    {
      kind: 'mismatch',
      engine: 'paired',
      live: false,
      revision: 0,
      expected: digestProjection(baseline),
      observed: digestProjection(candidate),
    },
  ])
  expect(observation.candidate?.incremental).toMatchObject({ kind: 'parsed', hast: candidate })
})

test('development observation preserves independent checks after a parse exception and leaves the suffix unexecuted', () => {
  const edits = seededEdits(176, 3)
  const reads: string[] = []
  const report = collectFuzzSchedule(edits, (edit, revision) =>
    observeFuzzRevision({
      edit,
      live: false,
      revision,
      remark: {
        incremental: () => observationRoot('remark'),
        fresh: () => {
          reads.push(`remark-fresh-${revision}`)
          if (revision === 1) throw createScriptError('Controlled parse failure')
          return observationRoot('remark')
        },
      },
      candidate: {
        incremental: () => {
          reads.push(`candidate-incremental-${revision}`)
          return observationRoot('candidate')
        },
        fresh: () => {
          reads.push(`candidate-fresh-${revision}`)
          return observationRoot('candidate-fresh')
        },
      },
    }),
  )
  expect(report).toMatchObject({
    declaredRevisions: 4,
    executedRevisions: 2,
    unexecutedRevisions: 2,
  })
  expect(report.failure).toMatchObject({ engine: 'tree-sitter', kind: 'mismatch', revision: 0 })
  expect(report.replay).toEqual(edits.slice(0, 1))
  expect(report.failures).toHaveLength(5)
  expect(report.observations[1].failures).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ engine: 'remark', kind: 'exception', phase: 'fresh', revision: 1 }),
      expect.objectContaining({ engine: 'tree-sitter', kind: 'mismatch', revision: 1 }),
      expect.objectContaining({ engine: 'paired', kind: 'mismatch', revision: 1 }),
    ]),
  )
  expect(reads).toEqual([
    'remark-fresh-0',
    'candidate-incremental-0',
    'candidate-fresh-0',
    'remark-fresh-1',
    'candidate-incremental-1',
    'candidate-fresh-1',
  ])
})

function bailedReport() {
  const assertionResults = Array.from({ length: 63 }, () => ({ status: 'passed' })).concat(
    [{ status: 'failed' }],
    Array.from({ length: 53 }, () => ({ status: 'pending' })),
  )
  return {
    numTotalTests: 117,
    numPassedTests: 63,
    numFailedTests: 1,
    numPendingTests: 0,
    numTodoTests: 0,
    testResults: [{ assertionResults }],
  }
}

test('bail preserves 117 declared, 63 passed, 1 failed and 53 pending assertion rows', () => {
  const raw = bailedReport()
  expect(parseTestCounts(raw)).toMatchObject({
    numTotalTests: 117,
    numPassedTests: 63,
    numFailedTests: 1,
    numPendingTests: 53,
  })
  expect(raw.numPendingTests).toBe(0)
  expect(parseTestCounts({ ...raw, testResults: [] }).numPendingTests).toBe(53)
  expect(() => parseTestCounts({ ...raw, numTotalTests: 1 })).toThrow()
  expect(() =>
    parseTestCounts({ ...raw, testResults: [{ assertionResults: [{ status: 'unknown' }] }] }),
  ).toThrow()
})

test('even exit-zero partial execution with no failures cannot pass checks-only', () => {
  const counts = parseTestCounts({
    numTotalTests: 117,
    numPassedTests: 63,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
  })
  expect(counts.numPendingTests).toBe(54)
  const run = {
    exitCode: 0,
    tests: counts.numTotalTests,
    passed: counts.numPassedTests,
    failed: counts.numFailedTests,
  }
  expect(qualificationExitCode({ ...executed, runs: [run] })).toBe(1)
})

test('report readback preserves raw bail JSON and missing reports fail with zero execution', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-report-'))
  try {
    const file = path.join(directory, 'bail.json')
    const raw = JSON.stringify(bailedReport())
    await writeFile(file, raw)
    expect((await readTestResult(file)).numPendingTests).toBe(53)
    expect(await readFile(file, 'utf8')).toBe(raw)
    const absent = await readTestResult(path.join(directory, 'missing.json'))
    expect(
      checkRunExitCode(0, {
        tests: absent.numTotalTests,
        passed: absent.numPassedTests,
        failed: absent.numFailedTests,
      }),
    ).toBe(1)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const EMPTY_TRACKED_DIFF_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
const sourceContext = {
  revision: 'revision',
  cleanTrackedDiff: EMPTY_TRACKED_DIFF_SHA256,
  lock: '1'.repeat(64),
  sourceClosure: '2'.repeat(64),
}

async function artifactBindingFixture() {
  const evidence = await mkdtemp(path.join(tmpdir(), 'markdown-artifact-binding-'))
  const external = await mkdtemp(path.join(tmpdir(), 'markdown-artifact-source-'))
  const rawReport = path.join(evidence, 'raw-tests.json')
  const frameLog = path.join(evidence, 'browser.log')
  const pairedReport = path.join(evidence, 'paired-raster.json')
  const image = path.join(evidence, 'images', '0-remark.png')
  const candidate = path.join(evidence, 'images', '0-tree-sitter.png')
  const overlay = path.join(evidence, 'images', '0-overlay.png')
  const calibration = path.join(external, 'calibration.png')
  await mkdirForTest(image)
  await writeFile(rawReport, JSON.stringify({ numTotalTests: 1 }))
  await writeFile(frameLog, 'frame output\n')
  await writeFile(image, 'remark image')
  await writeFile(candidate, 'candidate image')
  await writeFile(overlay, 'overlay image')
  await writeFile(calibration, 'calibration image')
  await writeFile(
    pairedReport,
    JSON.stringify({
      compared: [
        {
          baseline: 'images/0-remark.png',
          candidate: 'images/0-tree-sitter.png',
          overlay: 'images/0-overlay.png',
        },
      ],
    }),
  )
  await writeFile(
    frameLog,
    `MARKDOWN_BROWSER_CALIBRATION ${JSON.stringify({ engine: 'remark', browser: 'chromium', fixture: 'story', width: 390, theme: 'light', first: calibration, repeated: calibration })}\n`,
  )
  const runs = [
    {
      name: 'browser-remark-visual',
      exitCode: 0,
      tests: 1,
      passed: 1,
      failed: 0,
      pending: 0,
      todo: 0,
      log: frameLog,
      rawReport,
    },
    {
      name: 'paired-raster',
      exitCode: 0,
      tests: 1,
      passed: 1,
      failed: 0,
      pending: 0,
      todo: 0,
      log: pairedReport,
    },
  ] as const
  const bindings = await captureQualificationArtifacts(evidence, sourceContext, sourceContext, runs)
  return { evidence, external, bindings, runs }
}

async function mkdirForTest(file: string) {
  await mkdir(path.dirname(file), { recursive: true })
}

test('artifact bindings map provenance fields and exact per-run paths deterministically', async () => {
  const provenance = qualificationSourceContext({
    revision: 'revision',
    trackedDiffSha256: EMPTY_TRACKED_DIFF_SHA256,
    lockfileSha256: sourceContext.lock,
    sourceClosureSha256: sourceContext.sourceClosure,
  })
  expect(provenance).toEqual(sourceContext)

  const first = await artifactBindingFixture()
  try {
    const secondBindings = await captureQualificationArtifacts(
      first.evidence,
      sourceContext,
      sourceContext,
      first.runs,
    )
    expect(first.bindings).toEqual(secondBindings)
    expect(first.bindings.map((entry) => entry.runId)).toEqual([
      'browser-remark-visual',
      'paired-raster',
    ])
    expect(first.bindings.flatMap((entry) => entry.artifacts).map((entry) => entry.role)).toEqual(
      expect.arrayContaining([
        'rawQualificationReport',
        'frameLog',
        'pairedRasterReport',
        'pairedRasterImage',
        'pairedRasterCalibration',
      ]),
    )
    expect(
      first.bindings
        .flatMap((entry) => entry.artifacts)
        .every((entry) => !path.isAbsolute(entry.path) && !entry.path.startsWith('../')),
    ).toBe(true)
  } finally {
    await rm(first.evidence, { recursive: true, force: true })
    await rm(first.external, { recursive: true, force: true })
  }
})

test('artifact byte changes are rejected for raw JSON, frame logs, paired reports, images, and calibration', async () => {
  const fixture = await artifactBindingFixture()
  try {
    const artifacts = fixture.bindings.flatMap((entry) => entry.artifacts)
    for (const role of [
      'rawQualificationReport',
      'frameLog',
      'pairedRasterReport',
      'pairedRasterImage',
      'pairedRasterCalibration',
    ] as const) {
      const artifact = artifacts.find((entry) => entry.role === role)
      expect(artifact).toBeDefined()
      const file = path.resolve(fixture.evidence, artifact?.path ?? '')
      const original = await readFile(file)
      await writeFile(file, Buffer.concat([original, Buffer.from('changed')]))
      await expect(
        verifyQualificationArtifactBindings(fixture.evidence, fixture.bindings),
      ).rejects.toThrow('bytes changed after capture')
      await writeFile(file, original)
      await verifyQualificationArtifactBindings(fixture.evidence, fixture.bindings)
    }
  } finally {
    await rm(fixture.evidence, { recursive: true, force: true })
    await rm(fixture.external, { recursive: true, force: true })
  }
})

test('source changes during capture are blocked before bindings are emitted', async () => {
  const fixture = await artifactBindingFixture()
  try {
    await expect(
      captureQualificationArtifacts(
        fixture.evidence,
        sourceContext,
        { ...sourceContext, sourceClosure: '3'.repeat(64) },
        fixture.runs,
      ),
    ).rejects.toThrow('source changed during capture')
  } finally {
    await rm(fixture.evidence, { recursive: true, force: true })
    await rm(fixture.external, { recursive: true, force: true })
  }
})

test('compact native counts preserve qualification test accounting without raw pair arrays', () => {
  const workload = {
    id: 'control',
    family: 'warm-completed' as const,
    sourceBytes: 1,
    sourceSha256: 'a'.repeat(64),
    scheduleUnits: 0,
    comparisons: [],
    observedPairs: 20,
    mismatchedPairs: 0,
  }
  expect(
    pairedNativeTestRun({ status: 'PAIRED NATIVE PASS', workloads: [workload] }, 'evidence'),
  ).toMatchObject({ exitCode: 0, tests: 21, passed: 21, failed: 0 })
  expect(
    pairedNativeTestRun(
      { status: 'FAILED', workloads: [{ ...workload, mismatchedPairs: 2 }] },
      'evidence',
    ),
  ).toMatchObject({ exitCode: 1, tests: 21, passed: 18, failed: 3 })
  expect(pairedNativeTestRun({ status: 'INCONCLUSIVE', workloads: [] }, 'evidence').exitCode).toBe(
    1,
  )
})
