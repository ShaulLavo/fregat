import { finalizeNativeLaunch, finalizeProductionLaunch } from './production-capture-artifacts'
import { assembleTimingShards } from './production-shards'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, test } from 'vitest'
import {
  productionTrialSummary,
  productionFamilyCoverage,
  productionComparisons,
  productionMetricObservation,
  type ProductionTrial,
} from './production-analysis'
import {
  nativePairWorkloads,
  pairedTrialOrders,
  pairedConfidence,
  type NativePairWorkload,
} from './paired-native'
import { productionBrowserWorkloads, productionUpdates } from './production-workloads'
import { stable } from './serialization'
import { fixedChunks } from './workloads'
import { hashFile, writeJsonl } from './timing-artifacts'
import { writeProductionOracle } from './production-oracle'
import type { ProductionMarkdownReceipt } from '../../apps/web/test/factories/markdown-production-types'
import { productionTrialRecords } from './production-browser'
import {
  reconcileTimingEvidence as reconcileFiles,
  reconcileTimingManifest,
  type TimingArtifact,
  type TimingFreeze,
} from './production-reconciliation'

type TimingReconciliationInput = {
  readonly kind: 'production' | 'native'
  readonly report: TimingArtifact
  readonly frozen: TimingFreeze
  readonly capturedFiles?: readonly { readonly path: string; readonly bytes: Uint8Array }[]
  readonly artifacts: Readonly<
    Record<
      | 'host'
      | 'quietHost'
      | 'build'
      | 'buildManifest'
      | 'browser'
      | 'fonts'
      | 'trials'
      | 'sourceCapture',
      TimingArtifact | null
    >
  >
}
async function reconcileTimingEvidence(input: TimingReconciliationInput) {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-r34-reader-'))
  try {
    const files = await writeFixture(directory, input)
    return await reconcileFiles({
      root: directory,
      kind: input.kind,
      report: input.report.path,
      frozen: input.frozen,
      artifacts: files,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
function nativeComparisons(workload: string, seed: number) {
  return (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) => ({
    ...pairedConfidence({
      workload,
      metric,
      seed,
      resamples: 4096,
      baseline: Array.from({ length: 20 }, () => (metric === 'streamCpu' ? 2 : 1)),
      candidate: Array.from({ length: 20 }, () => (metric === 'streamCpu' ? 2 : 1)),
    }),
    domain: 'native',
    build: 'source',
  }))
}
async function writeFixture(directory: string, input: TimingReconciliationInput) {
  const raw = JSON.parse(input.report.contents)
  const rawPath =
    input.kind === 'production' ? 'raw-production-trials.jsonl' : 'raw-native-pairs.jsonl'
  let rows =
    input.kind === 'production'
      ? raw.warmupResults.concat(raw.rawTrials)
      : raw.workloads.flatMap((row: { id: string; pairs: unknown[] }) =>
          row.pairs.map((pair) => ({ workload: row.id, pair })),
        )
  if (input.kind === 'production') rows = await spillFixtureOracles(directory, rows)
  const contents = rows.map((row: unknown) => JSON.stringify(row)).join('\n') + '\n'
  await writeFile(path.join(directory, rawPath), contents)
  const reference = {
    path: rawPath,
    sha256: hash(contents),
    byteLength: Buffer.byteLength(contents),
    recordCount: rows.length,
  }
  raw.schemaVersion = 2
  if (input.kind === 'production') {
    raw.trialsArtifact = reference
    raw.sampleSummaries = raw.rawTrials.map(productionTrialSummary)
    raw.familyCoverage = productionFamilyCoverage(raw.rawTrials, input.frozen.productionWorkloads)
    delete raw.rawTrials
    delete raw.warmupResults
  } else {
    raw.pairsArtifact = reference
    raw.workloads = raw.workloads.map(
      (row: { id: string; pairs: { trial: number; mismatchedRevisions: unknown[] }[] }) => {
        const { pairs, ...summary } = row
        return {
          ...summary,
          family: input.frozen.nativeWorkloads.find((workload) => workload.id === row.id)?.family,
          observedPairs: pairs.filter((pair) => pair.trial >= 0).length,
          mismatchedPairs: pairs.filter((pair) => pair.mismatchedRevisions.length > 0).length,
          comparisons: nativeComparisons(row.id, raw.metadata.seed),
        }
      },
    )
  }
  const report = artifact(input.report.path, raw)
  const files: {
    -readonly [K in keyof TimingReconciliationInput['artifacts']]: K extends 'trials'
      ? string
      : string | null
  } = {
    host: null,
    quietHost: null,
    build: null,
    buildManifest: null,
    browser: null,
    fonts: null,
    trials: rawPath,
    sourceCapture: null,
  }
  for (const [name, file] of Object.entries(input.artifacts)) {
    if (!file || name === 'trials') continue
    let value = file.contents
    if (name === 'quietHost' || name === 'sourceCapture') {
      const sidecar = JSON.parse(value)
      sidecar.reportSha256 =
        input.report.sha256 === hash(input.report.contents) ? report.sha256 : input.report.sha256
      if (name === 'quietHost' && sidecar.nativeInvocation)
        sidecar.nativeInvocation.reportPath = report.path
      value = JSON.stringify(sidecar)
    }
    await mkdir(path.dirname(path.join(directory, file.path)), { recursive: true })
    await writeFile(path.join(directory, file.path), value)
    Reflect.set(files, name, file.path)
  }
  await writeFile(path.join(directory, report.path), report.contents)
  await mkdir(path.join(directory, 'assets'), { recursive: true })
  await writeFile(path.join(directory, 'assets/tree-sitter-markdown.wasm'), 'grammar')
  await writeFile(path.join(directory, 'assets/tree-sitter-markdown-chat.wasm'), 'chat grammar')
  await writeFile(path.join(directory, 'assets/tree-sitter-md.wasm'), 'resolver')
  await writeFile(path.join(directory, 'assets/fixture.woff2'), 'fixture font bytes')
  for (const file of input.capturedFiles ?? []) {
    await mkdir(path.dirname(path.join(directory, file.path)), { recursive: true })
    await writeFile(path.join(directory, file.path), file.bytes)
  }
  return files
}

async function spillFixtureOracles(directory: string, rows: readonly InlineProductionTrial[]) {
  const compact: ProductionTrial[] = []
  // Batch independent files so fixture setup does not serialize every durable flush.
  for (let offset = 0; offset < rows.length; offset += 8) {
    const batch = await Promise.allSettled(
      rows.slice(offset, offset + 8).map((row) => spillFixtureOracle(directory, row)),
    )
    compact.push(...batch.map(fixtureOracleResult))
  }
  return compact
}

function fixtureOracleResult(result: PromiseSettledResult<ProductionTrial>) {
  if (result.status === 'rejected') throw result.reason
  return result.value
}

type InlineProductionTrial = Omit<ProductionTrial, 'correctness' | 'freshCompleted'> & {
  correctness: ProductionMarkdownReceipt
  freshCompleted: ProductionMarkdownReceipt['final']
}
async function spillFixtureOracle(
  directory: string,
  row: InlineProductionTrial,
): Promise<ProductionTrial> {
  const captured = await writeProductionOracle({
    root: directory,
    file: `oracle-${row.pair}-${row.engine}.jsonl`,
    records: (async function* () {
      for (const frame of row.correctness.frames) yield { kind: 'frame' as const, frame }
      yield {
        kind: 'final' as const,
        frame: row.correctness.final,
        fullyReady: row.correctness.fullyReady,
        longTasks: row.correctness.longTasks,
        resources: row.correctness.resources,
      }
      yield { kind: 'fresh' as const, frame: row.freshCompleted }
    })(),
  })
  return { ...row, ...captured }
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}
function artifact(path: string, value: unknown): TimingArtifact {
  const contents = JSON.stringify(value)
  return { path, contents, sha256: hash(contents) }
}
function fixtureProductionComparisons(workload: string) {
  const values = { updateP95: 2, settlementP95: 3, mountP95: 4, streamCpu: 5 }
  return (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) => ({
    ...pairedConfidence({
      workload,
      metric,
      seed: 941,
      resamples: 4096,
      baseline: Array.from({ length: 20 }, () => values[metric]),
      candidate: Array.from({ length: 20 }, () => values[metric]),
    }),
    domain: 'browser',
    build: 'production',
    excludedPairs: [],
  }))
}

function instant(seconds: number) {
  return new Date(Date.UTC(2026, 9, 18, 12, 0, seconds)).toISOString()
}
function fixtureWorkload() {
  const workload = productionBrowserWorkloads().find(
    (entry) => entry.id === 'streaming-replay-mixed-256-fixed-24',
  )
  if (!workload) throw new Error('Missing development workload')
  return workload
}
const fontEnvironment = {
  fontFamily: 'Fixture Sans',
  fonts: [{ family: 'Fixture Sans', status: 'loaded', weight: '400' }],
}
const fontFiles = [{ path: 'assets/fixture.woff2', sha256: hash('fixture font bytes') }]
const fontFingerprint = hash(stable({ files: fontFiles, ...fontEnvironment }))
const nativeWorkload: NativePairWorkload = {
  id: 'synthetic-native',
  source: 'Text.',
  sourceBytes: 5,
  shape: 'synthetic',
  family: 'warm-completed',
  scheduleUnits: 0,
}
function nativeManifestHash() {
  return hash(
    JSON.stringify([
      {
        ...nativeWorkload,
        source: undefined,
        sourceSha256: hash(nativeWorkload.source),
        revisionSourceSha256: [],
      },
    ]),
  )
}
function freeze(workload = fixtureWorkload()): TimingFreeze {
  return {
    identity: {
      candidateCommit: 'a'.repeat(40),
      candidateSourceSha256: hash(JSON.stringify([])),
      grammarSha256: hash('grammar'),
      chatGrammarSha256: hash('chat grammar'),
      resolverSha256: hash('resolver'),
      lockfileSha256: hash('lock'),
      budgetSha256: hash('budget'),
      evaluationManifestSha256: hash('evaluation'),
      workloadManifestSha256: nativeManifestHash(),
    },
    provenance: {
      revision: 'a'.repeat(40),
      trackedDiffSha256: hash(''),
      sourceClosureSha256: hash('closure'),
      lockfileSha256: hash('lock'),
    },
    productionWorkloads: [workload],
    nativeWorkloads: [nativeWorkload],
    fontFingerprint,
  }
}
function projection(input: string) {
  const content = { text: input, elements: [] }
  const output = {
    digest: hash(JSON.stringify(content)),
    textBytes: Buffer.byteLength(input),
    elementCount: 0,
  }
  return { inputSha256: hash(input), paintedOutput: output, ...content }
}
function productionRow(
  pair: number,
  engine: ProductionTrial['engine'],
  workload = fixtureWorkload(),
): InlineProductionTrial {
  const inputs = productionUpdates(workload).concat([workload.source])
  const frames = inputs.map((input, index) => ({
    revision: index + 1,
    inputSha256: hash(input),
    inputUtf16Units: input.length,
    live: index < inputs.length - 1,
    scheduled: index * 40 + 1,
    received: index * 40 + 1,
    committed: index * 40 + 2,
    parseCalls: 1,
    parserWallMs: 0.5,
    output: projection(input).paintedOutput,
    observedRevision: index + 1,
    painted: index * 40 + 3,
    paintedOutput: projection(input).paintedOutput,
  }))
  const final = frames[frames.length - 1]
  const oracle = inputs.map(projection)
  const lastOracle = oracle[oracle.length - 1]
  const held = { ...final, revision: frames.length + 1 }
  const released = { ...final, revision: frames.length + 2 }
  return {
    workload: workload.id,
    family: workload.family,
    pair,
    order: Math.abs(pair) % 2 === 0 ? 'AB' : 'BA',
    engine,
    arrival: workload.arrival,
    cache: workload.cache,
    navigationMs: 1,
    initializationMs: 0,
    environment: {
      userAgent: 'synthetic',
      concurrency: 8,
      deviceScaleFactor: 1,
      viewport: { width: 1440, height: 900 },
      ...fontEnvironment,
    },
    receipt: {
      started: 0,
      ended: final.painted + 1,
      processed: frames,
      frames,
      final,
      fullyReady: final.painted + 1,
      fullyReadyOutput: final.paintedOutput,
      skippedPaintRevisions: [],
      heldSyntax: { held, released, holdMs: 0 },
      longTasks: [],
      resources: [],
    },
    correctness: {
      frames: oracle.map((entry, index) => ({ ...frames[index], ...entry })),
      final: { ...final, ...lastOracle },
      fullyReady: final.painted + 1,
      longTasks: [],
      resources: [],
    },
    freshCompleted: { ...final, ...lastOracle },
    cpu: null,
    updateCpu: frames
      .concat([held, released])
      .map((tick) => ({ revision: tick.revision, mainThreadCpuMs: 1 })),
    workers: { created: 0, active: 0 },
    workerCpu: [],
    streamMainThreadCpuMs: 5,
    network: [
      {
        id: 'host',
        url: 'https://fixture.invalid/index.html',
        type: 'Document',
        fromCache: false,
        transferredBytes: 10,
        completionEncodedBytes: 10,
        dataReceivedBytes: 8,
        transferScope: 'full-request',
        phase: 'navigation',
        kind: 'host',
        failure: null,
        target: 'page',
        workerTargetId: null,
        resolvedByWorkerRequestId: null,
      },
    ],
    timeline: null,
    resourceWindows: null,
    resourceControlWindows: null,
  }
}
function fixtureControls() {
  return {
    knownGood: {
      expected: hash('control output'),
      observed: hash('control output'),
      revision: 2,
      observedRevision: 2,
    },
    missingExpectation: { rejected: true, reason: 'Missing expectation rejected' },
    wrongExpectation: { rejected: true, reason: 'Wrong output rejected' },
    longTask: { supported: true, observed: [80] },
  }
}
function reportFixture(workload = fixtureWorkload()) {
  const frozen = freeze(workload)
  const host = artifact('host.json', { host: 'fixture-host', observedAt: instant(0) })
  const buildManifest = artifact('manifest.json', { 'index.html': { file: 'assets/main.js' } })
  const artifacts = [
    { file: 'tree-sitter-markdown.wasm', sha256: frozen.identity.grammarSha256, bytes: 7 },
    {
      file: 'tree-sitter-markdown-chat.wasm',
      sha256: frozen.identity.chatGrammarSha256,
      bytes: 12,
    },
    { file: 'tree-sitter-md.wasm', sha256: frozen.identity.resolverSha256, bytes: 8 },
    { file: 'fixture.woff2', sha256: fontFiles[0].sha256, bytes: 18 },
  ]
  const build = {
    schemaVersion: 1,
    sourceBefore: frozen.provenance,
    sourceAfter: frozen.provenance,
    artifactManifestSha256: buildManifest.sha256,
    budgetSha256: frozen.identity.budgetSha256,
    artifacts,
  }
  const rows = [-3, -2, -1]
    .concat(Array.from({ length: 20 }, (_, pair) => pair))
    .flatMap((pair) =>
      Math.abs(pair) % 2 === 0
        ? [productionRow(pair, 'remark', workload), productionRow(pair, 'tree-sitter', workload)]
        : [productionRow(pair, 'tree-sitter', workload), productionRow(pair, 'remark', workload)],
    )
  const failures: unknown[] = []
  const comparisons: unknown[] = fixtureProductionComparisons(workload.id)
  const report = {
    schemaVersion: 1,
    build: 'production',
    timingStatus: 'PROMOTION_CAPTURE_UNRECONCILED',
    controls: fixtureControls(),
    capture: {
      kind: 'promotion',
      hostEvidence: { sha256: host.sha256, observation: JSON.parse(host.contents) },
    },
    host: {
      id: 'fixture-host',
      platform: 'darwin',
      architecture: 'arm64',
      hardware: 'fixture CPU',
      osRelease: 'fixture OS',
      memoryBytes: 1000,
      before: { observedAt: instant(1), loadAverage: [0, 0, 0], logicalCpus: 8 },
      after: { observedAt: instant(9), loadAverage: [0, 0, 0], logicalCpus: 8 },
    },
    browser: {
      name: 'chromium',
      version: '140.0.fixture',
      headless: false,
      executablePath: '/fixture/chromium',
      requestedArgs: ['--disable-background-timer-throttling'],
      actualArgs: [
        '/fixture/chromium',
        '--disable-background-timer-throttling',
        '--user-data-dir=/fixture/playwright_chromiumdev_profile-123',
      ],
    },
    provenance: { ...frozen.provenance, runtime: { bun: '1.3.fixture', node: '24.fixture' } },
    servedBuild: {
      revision: build.sourceAfter.revision,
      sourceClosureSha256: build.sourceAfter.sourceClosureSha256,
      budgetSha256: build.budgetSha256,
      artifactManifestSha256: build.artifactManifestSha256,
      artifactCount: artifacts.length,
    },
    frozenBudgetSha256: frozen.identity.budgetSha256,
    workloadManifest: {
      schemaVersion: 1,
      domain: 'browser',
      build: 'production',
      workloads: [
        {
          id: workload.id,
          sourceBytes: workload.sourceBytes,
          sourceSha256: hash(workload.source),
          scheduleUnits: workload.scheduleUnits,
          scheduleId: workload.scheduleId,
          arrival: workload.arrival,
          metrics: ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'],
          expectedInputUpdates: productionUpdates(workload).length + 1,
          paintPolicy: 'every-revision',
        },
      ],
    },
    selectedWorkloads: [{ ...workload, source: undefined, sourceSha256: hash(workload.source) }],
    trials: 20,
    warmups: 3,
    rawTrials: rows.filter((row) => row.pair >= 0),
    warmupResults: rows.filter((row) => row.pair < 0),
    failures,
    comparisons,
  }
  return { frozen, host, buildManifest, build, report }
}
function quietArtifact(report: TimingArtifact) {
  return artifact('quiet-host.json', {
    host: 'fixture-host',
    reportSha256: report.sha256,
    platform: 'darwin',
    architecture: 'arm64',
    hardware: 'fixture CPU',
    osRelease: 'fixture OS',
    memoryBytes: 1000,
    nativeInvocation: {
      executablePath: '/fixture/bun',
      argv: [
        '/fixture/bun',
        'scripts/markdown/paired-native.ts',
        '--mode',
        'qualification',
        '--out',
        '/fixture',
      ],
      runtime: 'bun 1.3.fixture',
      reportPath: report.path,
      environment: { NODE_OPTIONS: null, BUN_OPTIONS: null },
    },
    observations: [0, 1, 5, 9, 10].map((seconds) => ({
      observedAt: instant(seconds),
      loadAverage: [0, 0, 0],
      logicalCpus: 8,
      ownerBusy: false,
      acPower: true,
      competingCpuPercent: 0,
      runningJobs: [],
    })),
  })
}
function productionInput(
  change: (report: ReturnType<typeof reportFixture>['report']) => void = () => {},
  workload = fixtureWorkload(),
): TimingReconciliationInput {
  const fixture = reportFixture(workload)
  change(fixture.report)
  const report = artifact('production-browser.json', fixture.report)
  const contents = fixture.report.rawTrials.map((row) => JSON.stringify(row)).join('\n') + '\n'
  return {
    kind: 'production',
    report,
    frozen: fixture.frozen,
    artifacts: {
      host: fixture.host,
      quietHost: quietArtifact(report),
      build: artifact('markdown-probe-build.json', fixture.build),
      buildManifest: fixture.buildManifest,
      browser: artifact('browser.json', {
        host: 'fixture-host',
        executablePath: fixture.report.browser.executablePath,
        version: fixture.report.browser.version,
        args: fixture.report.browser.actualArgs,
      }),
      fonts: artifact('fonts.json', {
        host: 'fixture-host',
        fingerprint: fontFingerprint,
        files: fontFiles,
        ...fontEnvironment,
      }),
      trials: { path: 'raw-production-trials.jsonl', contents, sha256: hash(contents) },
      sourceCapture: null,
    },
  }
}
function nativeInput(
  workloads: readonly NativePairWorkload[] = [nativeWorkload],
): TimingReconciliationInput {
  const sources = [
    {
      file: 'apps/web/src/features/chat/providers/full-only.ts',
      sha256: hash('full closure source'),
    },
    {
      file: 'packages/singapore/packages/tree-sitter/src/treeSitter/markdown.ts',
      sha256: hash('editor markdown loader'),
    },
    {
      file: 'packages/singapore/packages/tree-sitter/test/wasm-memory.browser.test.ts',
      sha256: hash('editor browser memory test'),
    },
    {
      file: 'packages/singapore/packages/tree-sitter/test/wasm-memory.test.ts',
      sha256: hash('editor memory test'),
    },
    { file: 'scripts/markdown/paired-native.ts', sha256: hash('native source') },
  ]
  const sourceFiles = [{ path: 'scripts/markdown/paired-native.ts', sha256: hash('native source') }]
  const base = freeze()
  const frozen = {
    ...base,
    identity: {
      ...base.identity,
      candidateSourceSha256: hash(JSON.stringify(sources)),
      workloadManifestSha256: hash(
        JSON.stringify(
          workloads.map(({ source, revisions, ...entry }) => ({
            ...entry,
            sourceSha256: hash(source),
            revisionSourceSha256: revisions?.map(hash) ?? [],
          })),
        ),
      ),
    },
    provenance: { ...base.provenance, sourceClosureSha256: hash(JSON.stringify(sources)) },
    nativeWorkloads: workloads,
  }
  const metadata = {
    ...frozen.identity,
    startedAt: instant(1),
    finishedAt: instant(9),
    seed: 176,
    trials: 20,
    warmups: 3,
    timingStatus: 'EXPLORATORY',
    host: 'fixture-host',
    hardware: 'fixture CPU',
    platform: 'darwin',
    architecture: 'arm64',
    runtime: 'bun 1.3.fixture',
    sourceFiles,
    candidateSourceSha256: hash(JSON.stringify(sourceFiles)),
    revision: frozen.provenance.revision,
  }
  const report = artifact('paired-native.json', {
    schemaVersion: 1,
    scope: 'paired-native-source',
    mode: 'qualification',
    metadata,
    workloads: workloads.map((workload) => ({
      id: workload.id,
      sourceBytes: workload.sourceBytes,
      sourceSha256: hash(workload.source),
      scheduleUnits: workload.scheduleUnits,
      pairs: syntheticNativePairs(workload, metadata.seed),
    })),
  })
  return {
    kind: 'native',
    report,
    capturedFiles: [
      {
        path: 'snapshot/apps/web/src/features/chat/providers/full-only.ts',
        bytes: Buffer.from('full closure source'),
      },
      {
        path: 'snapshot/packages/singapore/packages/tree-sitter/src/treeSitter/markdown.ts',
        bytes: Buffer.from('editor markdown loader'),
      },
      {
        path: 'snapshot/packages/singapore/packages/tree-sitter/test/wasm-memory.browser.test.ts',
        bytes: Buffer.from('editor browser memory test'),
      },
      {
        path: 'snapshot/packages/singapore/packages/tree-sitter/test/wasm-memory.test.ts',
        bytes: Buffer.from('editor memory test'),
      },
      { path: 'snapshot/scripts/markdown/paired-native.ts', bytes: Buffer.from('native source') },
      { path: 'bun.lock', bytes: Buffer.from('lock') },
      { path: 'grammar.wasm', bytes: Buffer.from('grammar') },
      { path: 'chat-grammar.wasm', bytes: Buffer.from('chat grammar') },
      { path: 'resolver.wasm', bytes: Buffer.from('resolver') },
      { path: 'budget.json', bytes: Buffer.from('budget') },
    ],
    frozen,
    artifacts: {
      host: null,
      quietHost: quietArtifact(report),
      build: null,
      buildManifest: null,
      browser: null,
      fonts: null,
      trials: null,
      sourceCapture: artifact('source-capture.json', {
        reportSha256: report.sha256,
        sourceRoot: 'snapshot',
        provenance: { ...frozen.provenance, sources },
        files: {
          lockfile: 'bun.lock',
          grammar: 'grammar.wasm',
          chatGrammar: 'chat-grammar.wasm',
          resolver: 'resolver.wasm',
          budget: 'budget.json',
        },
      }),
    },
  }
}

function syntheticNativePairs(workload: NativePairWorkload, seed: number) {
  const warmups = pairedTrialOrders(3, seed).map((order, index) => ({ trial: -index - 1, order }))
  const measured = pairedTrialOrders(20, seed).map((order, trial) => ({ trial, order }))
  return warmups.concat(measured).map(({ trial, order }) => ({
    trial,
    order,
    remark: syntheticNativeTrial(workload, trial, 'remark'),
    candidate: syntheticNativeTrial(workload, trial, 'tree-sitter'),
    mismatchedRevisions: [],
  }))
}

function syntheticNativeTrial(
  workload: NativePairWorkload,
  trial: number,
  engine: 'remark' | 'tree-sitter',
) {
  const updates =
    workload.revisions ??
    (workload.scheduleUnits > 0
      ? Array.from(fixedChunks(workload.source, workload.scheduleUnits), (frame) => frame.text)
      : [workload.source])
  const warmupTiming = engine === 'remark' ? 100 : 1000
  const timing = trial < 0 ? warmupTiming : 1
  const revisions = updates.map((source, revision) => ({
    revision,
    offset: source.length,
    phase: 'update',
    wallMs: timing,
    cpuMs: timing,
    outputDigest: hash(source),
    sourceCoordinateFailures: [],
  }))
  return {
    engine,
    trial,
    mountMs: timing,
    streamCpuMs: 2 * timing,
    revisions: revisions.concat([
      {
        revision: updates.length,
        offset: workload.source.length,
        phase: 'settlement',
        wallMs: timing,
        cpuMs: timing,
        outputDigest: hash(workload.source),
        sourceCoordinateFailures: [],
      },
    ]),
  }
}

async function actualFixtureResult(
  kind: TimingReconciliationInput['kind'],
  change: (directory: string, files: Awaited<ReturnType<typeof writeFixture>>) => Promise<void>,
) {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-actual-capture-'))
  const input = kind === 'production' ? productionInput() : nativeInput()
  try {
    const files = await writeFixture(directory, input)
    await change(directory, files)
    return await reconcileFiles({
      root: directory,
      kind,
      report: input.report.path,
      frozen: input.frozen,
      artifacts: files,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
test.each([
  { kind: 'production' as const, file: 'assets/tree-sitter-markdown.wasm' },
  { kind: 'production' as const, file: 'assets/tree-sitter-markdown-chat.wasm' },
  { kind: 'production' as const, file: 'assets/tree-sitter-md.wasm' },
  { kind: 'production' as const, file: 'assets/fixture.woff2' },
  { kind: 'native' as const, file: 'grammar.wasm' },
  { kind: 'native' as const, file: 'chat-grammar.wasm' },
  { kind: 'native' as const, file: 'snapshot/apps/web/src/features/chat/providers/full-only.ts' },
])('actual $kind capture rejects changed $file bytes', async ({ kind, file }) => {
  const result = await actualFixtureResult(kind, async (directory) => {
    await writeFile(path.join(directory, file), 'tampered actual capture bytes')
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.kind === 'mismatch')).toBe(true)
})
test.each([
  { kind: 'production' as const, file: 'assets/tree-sitter-markdown.wasm' },
  { kind: 'production' as const, file: 'assets/tree-sitter-markdown-chat.wasm' },
  { kind: 'native' as const, file: 'grammar.wasm' },
  { kind: 'native' as const, file: 'chat-grammar.wasm' },
])('actual $kind capture rejects missing $file bytes', async ({ kind, file }) => {
  const result = await actualFixtureResult(kind, async (directory) => {
    await rm(path.join(directory, file))
  })
  expect(result.verdict).not.toBe('VERIFIED')
  expect(
    result.findings.some((entry) => entry.kind === 'missing' && entry.path.includes(file)),
  ).toBe(true)
})

test.each(['grammarSha256', 'chatGrammarSha256'] as const)(
  'native metadata requires matching %s',
  async (field) => {
    const input = nativeInput()
    const report = JSON.parse(input.report.contents)
    report.metadata[field] = hash('changed grammar')
    const result = await reconcileTimingEvidence({
      ...input,
      report: artifact(input.report.path, report),
    })
    expect(result.verdict).toBe('NOT VERIFIED')
    expect(result.findings.some((entry) => entry.path === `native.metadata.${field}`)).toBe(true)
  },
)

test.each(['grammarSha256', 'chatGrammarSha256'] as const)(
  'native raw schema rejects metadata without %s',
  async (field) => {
    const input = nativeInput()
    const report = JSON.parse(input.report.contents)
    delete report.metadata[field]
    const result = await reconcileTimingEvidence({
      ...input,
      report: artifact(input.report.path, report),
    })
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.findings.some((entry) => entry.path === `report.metadata.${field}`)).toBe(true)
  },
)

test.each(['grammarSha256', 'chatGrammarSha256'] as const)(
  'frozen timing schema rejects missing %s before opening captures',
  async (field) => {
    const directory = await mkdtemp(path.join(tmpdir(), 'markdown-missing-grammar-freeze-'))
    try {
      const frozen = JSON.parse(JSON.stringify(freeze()))
      delete frozen.identity[field]
      const manifestPath = path.join(directory, 'manifest.json')
      await writeFile(path.join(directory, 'freeze.json'), JSON.stringify(frozen))
      await writeFile(
        manifestPath,
        JSON.stringify({
          schemaVersion: 1,
          kind: 'native',
          report: 'unopened-report.json',
          frozen: 'freeze.json',
          artifacts: {
            host: null,
            quietHost: null,
            build: null,
            buildManifest: null,
            browser: null,
            fonts: null,
            trials: 'unopened-pairs.jsonl',
            sourceCapture: null,
          },
        }),
      )
      await expect(
        reconcileTimingManifest({ manifestPath, outputPath: path.join(directory, 'result.json') }),
      ).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test.each(['missing', 'swapped'] as const)(
  'native source capture rejects %s CHAT role',
  async (change) => {
    const input = nativeInput()
    const capture = JSON.parse(input.artifacts.sourceCapture?.contents ?? '{}')
    if (change === 'missing') delete capture.files.chatGrammar
    if (change === 'swapped') {
      capture.files.chatGrammar = 'grammar.wasm'
      capture.files.grammar = 'chat-grammar.wasm'
    }
    const result = await reconcileTimingEvidence({
      ...input,
      artifacts: { ...input.artifacts, sourceCapture: artifact('source-capture.json', capture) },
    })
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.findings.some((entry) => entry.path.startsWith('sourceCapture'))).toBe(true)
  },
)

async function changeBuildRoles(
  directory: string,
  files: Awaited<ReturnType<typeof writeFixture>>,
  change: 'missing-base' | 'missing-chat' | 'swapped' | 'changed-chat' | 'wrong-role',
) {
  if (!files.build) expect.fail('Missing fixture build')
  const buildPath = path.join(directory, files.build)
  const build = JSON.parse(await readFile(buildPath, 'utf8'))
  if (change === 'missing-base') build.artifacts.shift()
  if (change === 'missing-chat') build.artifacts.splice(1, 1)
  if (change === 'swapped') {
    build.artifacts[0].sha256 = hash('chat grammar')
    build.artifacts[0].bytes = Buffer.byteLength('chat grammar')
    build.artifacts[1].sha256 = hash('grammar')
    build.artifacts[1].bytes = Buffer.byteLength('grammar')
    await writeFile(path.join(directory, 'assets/tree-sitter-markdown.wasm'), 'chat grammar')
    await writeFile(path.join(directory, 'assets/tree-sitter-markdown-chat.wasm'), 'grammar')
  }
  if (change === 'changed-chat') {
    build.artifacts[1].sha256 = hash('changed CHAT bytes')
    build.artifacts[1].bytes = Buffer.byteLength('changed CHAT bytes')
    await writeFile(
      path.join(directory, 'assets/tree-sitter-markdown-chat.wasm'),
      'changed CHAT bytes',
    )
  }
  if (change === 'wrong-role') {
    build.artifacts[1].file = 'unrelated.wasm'
    await writeFile(path.join(directory, 'assets/unrelated.wasm'), 'chat grammar')
  }
  await writeFile(buildPath, JSON.stringify(build))
  const reportPath = path.join(directory, 'production-browser.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8'))
  report.servedBuild.artifactCount = build.artifacts.length
  const contents = JSON.stringify(report)
  await writeFile(reportPath, contents)
  if (!files.quietHost) expect.fail('Missing fixture quiet host')
  const quietPath = path.join(directory, files.quietHost)
  const quiet = JSON.parse(await readFile(quietPath, 'utf8'))
  quiet.reportSha256 = hash(contents)
  await writeFile(quietPath, JSON.stringify(quiet))
}

test.each(['missing-base', 'missing-chat', 'swapped', 'changed-chat', 'wrong-role'] as const)(
  'production role binding rejects %s with rehashed build evidence',
  async (change) => {
    const result = await actualFixtureResult('production', async (directory, files) => {
      await changeBuildRoles(directory, files, change)
    })
    expect(result.verdict).not.toBe('VERIFIED')
    expect(
      result.findings.some(
        (entry) => entry.path === 'build.grammarSha256' || entry.path === 'build.chatGrammarSha256',
      ),
    ).toBe(true)
  },
)

test('missing actual raw file cannot establish observed coverage', async () => {
  const result = await actualFixtureResult('production', async (directory, files) => {
    await rm(path.join(directory, files.trials))
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.coverage).toEqual([])
})
test('manifest trial path must use exact descriptor canonical spelling', async () => {
  const result = await actualFixtureResult('production', async (_directory, files) => {
    files.trials = './' + files.trials
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path === 'trials.manifestPath')).toBe(true)
})
test.each([1, 3])('timing envelope schema %s has no compatibility path', async (schemaVersion) => {
  const result = await actualFixtureResult('production', async (directory) => {
    const filename = path.join(directory, 'production-browser.json')
    const header = JSON.parse(await readFile(filename, 'utf8'))
    header.schemaVersion = schemaVersion
    await writeFile(filename, JSON.stringify(header))
  })
  expect(result.verdict).not.toBe('VERIFIED')
  expect(result.samples).toEqual([])
})

test.each(['sampleSummaries', 'familyCoverage'] as const)(
  'rehashed forged %s cannot authorize raw observations',
  async (key) => {
    const result = await actualFixtureResult('production', async (directory, files) => {
      const filename = path.join(directory, 'production-browser.json')
      const header = JSON.parse(await readFile(filename, 'utf8'))
      header[key] = []
      await writeFile(filename, JSON.stringify(header))
      const raw = await readFile(path.join(directory, files.trials), 'utf8')
      await rebindFixture(directory, productionInput(), raw, raw.trimEnd().split('\n').length)
    })
    expect(result.verdict).toBe('NOT VERIFIED')
    expect(result.findings.some((finding) => finding.path.startsWith(`report.${key}`))).toBe(true)
    expect(result.findings.some((finding) => finding.path.endsWith('reportSha256'))).toBe(false)
  },
)
test.each([
  'missing-frame',
  'changed-frame',
  'reordered',
  'missing-final',
  'changed-final',
  'missing-fresh',
  'changed-fresh',
] as const)(
  'actual reader rejects oracle %s with every enclosing artifact rehashed',
  async (mutation) => {
    const result = await actualFixtureResult('production', async (directory, files) => {
      const rawPath = path.join(directory, files.trials)
      const lines = (await readFile(rawPath, 'utf8')).trimEnd().split('\n')
      const row: ProductionTrial = JSON.parse(lines.at(-1) ?? '')
      const file = row.correctness.artifact.path
      const records = (await readFile(path.join(directory, file), 'utf8'))
        .trimEnd()
        .split('\n')
        .map((line) => JSON.parse(line))
      const final = records.length - 2
      if (mutation === 'missing-frame') records.splice(0, 1)
      if (mutation === 'changed-frame') records[0].frame.text += 'tampered'
      if (mutation === 'reordered') records.reverse()
      if (mutation === 'missing-final') records.splice(final, 1)
      if (mutation === 'changed-final') records[final].frame.painted++
      if (mutation === 'missing-fresh') records.pop()
      if (mutation === 'changed-fresh') records[final + 1].frame.text += 'tampered'
      await writeFile(
        path.join(directory, file),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      )
      const artifact = {
        ...(await hashFile({ root: directory, file })),
        recordCount: records.length,
      }
      lines[lines.length - 1] = JSON.stringify({
        ...row,
        correctness: { ...row.correctness, artifact },
      })
      const contents = lines.join('\n') + '\n'
      await writeFile(rawPath, contents)
      await rebindFixture(directory, productionInput(), contents, lines.length)
    })
    expect(result.verdict).toBe('NOT VERIFIED')
    expect(result.findings.some((finding) => finding.path.endsWith('.oracle'))).toBe(true)
    expect(result.findings.some((finding) => finding.path.endsWith('reportSha256'))).toBe(false)
  },
)
test('actual reader requires oracle files and reports their observed transitive artifact closure', async () => {
  const result = await actualFixtureResult('production', async () => {})
  expect(result.verdict).toBe('VERIFIED')
  const oracles = result.artifacts.filter((file) => path.basename(file.path).startsWith('oracle-'))
  expect(oracles).toHaveLength(46)
  expect(new Set(oracles.map((file) => file.path)).size).toBe(46)
  expect(oracles.every((file) => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true)
  expect(JSON.stringify(result)).not.toContain('"observationSha256"')
})
test('actual reader cannot substitute compact receipts for a missing oracle artifact', async () => {
  const result = await actualFixtureResult('production', async (directory) => {
    await rm(path.join(directory, 'oracle-19-tree-sitter.jsonl'))
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path.endsWith('.oracle'))).toBe(true)
})

test('resource fold retains numeric windows without retaining arbitrary raw record facts', async () => {
  const window = {
    cycles: 20,
    elapsedMs: 1,
    jsHeapUsedBeforeBytes: 10,
    jsHeapUsedAfterBytes: 10,
    backingStorageBeforeBytes: 10,
    backingStorageAfterBytes: 10,
    parserWasmReservedBeforeBytes: 10,
    parserWasmReservedAfterBytes: 10,
    jsHeapReservedBeforeBytes: 10,
    jsHeapReservedAfterBytes: 10,
    queryObserversBefore: 1,
    queryObserversAfter: 1,
    retainedMessageNodes: 0,
    simultaneousMessages: 4,
    peakWasmReservedBytes: 10,
    peakMessageNodes: 4,
    arbitraryRawFacts: { projection: 'raw-only-secret-fact' },
  }
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      report.rawTrials[0] = {
        ...report.rawTrials[0],
        resourceWindows: Array.from({ length: 6 }, () => window),
        resourceControlWindows: Array.from({ length: 6 }, () => window),
      }
    }),
  )
  expect(result.verdict).toBe('VERIFIED')
  expect(result.resourceTrials).toHaveLength(1)
  expect(result.resourceTrials[0].resourceWindows).toHaveLength(6)
  expect(JSON.stringify(result)).not.toContain('raw-only-secret-fact')
})

async function mutateFileFixture(options: {
  readonly kind: 'production' | 'native'
  readonly mutate: (lines: string[]) => string[]
  readonly rebind: boolean
  readonly finalLf?: boolean
}) {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-file-tamper-'))
  const input = options.kind === 'production' ? productionInput() : nativeInput()
  try {
    const files = await writeFixture(directory, input)
    const rawPath = path.join(directory, files.trials)
    const lines = (await readFile(rawPath, 'utf8')).trimEnd().split('\n')
    const changed = options.mutate(lines)
    const contents = changed.join('\n') + (options.finalLf === false ? '' : '\n')
    await writeFile(rawPath, contents)
    if (options.rebind) await rebindFixture(directory, input, contents, changed.length)
    return await reconcileFiles({
      root: directory,
      kind: input.kind,
      report: input.report.path,
      frozen: input.frozen,
      artifacts: files,
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
async function rebindFixture(
  directory: string,
  input: TimingReconciliationInput,
  contents: string,
  recordCount: number,
) {
  const filename = path.join(directory, input.report.path)
  const report = JSON.parse(await readFile(filename, 'utf8'))
  const key = input.kind === 'production' ? 'trialsArtifact' : 'pairsArtifact'
  report[key] = {
    ...report[key],
    sha256: hash(contents),
    byteLength: Buffer.byteLength(contents),
    recordCount,
  }
  const encoded = JSON.stringify(report)
  await writeFile(filename, encoded)
  for (const key of ['quietHost', 'sourceCapture'] as const) {
    const artifact = input.artifacts[key]
    if (!artifact) continue
    const filename = path.join(directory, artifact.path)
    const sidecar = JSON.parse(await readFile(filename, 'utf8'))
    sidecar.reportSha256 = hash(encoded)
    await writeFile(filename, JSON.stringify(sidecar))
  }
}
function changedProductionLine(
  lines: string[],
  index: number,
  change: (row: ProductionTrial) => ProductionTrial,
) {
  const row: ProductionTrial = JSON.parse(lines[index])
  lines[index] = JSON.stringify(change(row))
  return lines
}
const rawMutations = [
  {
    name: 'last warmup projection',
    change: (lines: string[]) =>
      changedProductionLine(lines, 5, (row) => ({
        ...row,
        correctness: {
          ...row.correctness,
          final: { ...row.correctness.final, observationSha256: hash('tampered late warmup') },
        },
      })),
  },
  {
    name: 'last measured duplicate',
    change: (lines: string[]) => {
      lines[45] = lines[44]
      return lines
    },
  },
  { name: 'last measured missing arm', change: (lines: string[]) => lines.slice(0, -1) },
  {
    name: 'physical arm order',
    change: (lines: string[]) => {
      const first = lines[0]
      lines[0] = lines[1]
      lines[1] = first
      return lines
    },
  },
  {
    name: 'unfrozen family',
    change: (lines: string[]) =>
      changedProductionLine(lines, 45, (row) => ({ ...row, family: 'warm-completed' })),
  },
  {
    name: 'late input hash',
    change: (lines: string[]) =>
      changedProductionLine(lines, 45, (row) => ({
        ...row,
        freshCompleted: { ...row.freshCompleted, inputSha256: hash('wrong') },
      })),
  },
]
test.each(rawMutations)('actual files reject rehashed $name', async ({ change }) => {
  const result = await mutateFileFixture({ kind: 'production', mutate: change, rebind: true })
  expect(result.verdict).not.toBe('VERIFIED')
  expect(result.findings.some((finding) => finding.kind === 'mismatch')).toBe(true)
  expect(result.findings.some((finding) => finding.path === 'trials')).toBe(false)
})
test('actual raw final-byte digest mismatch cannot publish provisional samples', async () => {
  const result = await mutateFileFixture({
    kind: 'production',
    rebind: false,
    mutate: (lines) =>
      changedProductionLine(lines, 45, (row) => ({ ...row, navigationMs: row.navigationMs + 1 })),
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path === 'trials')).toBe(true)
})
test('actual raw EOF requires LF even after descriptor rehash', async () => {
  const result = await mutateFileFixture({
    kind: 'production',
    rebind: true,
    finalLf: false,
    mutate: (lines) => lines,
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path === 'trials')).toBe(true)
})
test('actual native pair order remains authoritative after rehash', async () => {
  const result = await mutateFileFixture({
    kind: 'native',
    rebind: true,
    mutate: (lines) => {
      const first = lines[0]
      lines[0] = lines[1]
      lines[1] = first
      return lines
    },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path === 'trials.record.0.identity')).toBe(true)
  expect(result.metrics.observedWarmupTrials).toBe(3)
})

test('released producer encounter order reconciles from the actual sealed raw file', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-r34-producer-reader-'))
  try {
    const input = productionInput()
    const files = await writeFixture(directory, input)
    const envelope = JSON.parse(await readFile(path.join(directory, input.report.path), 'utf8'))
    const original: ProductionTrial[] = (await readFile(path.join(directory, files.trials), 'utf8'))
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line))
    await rm(path.join(directory, files.trials))
    const failures: string[] = []
    const observed = await writeJsonl({
      root: directory,
      file: files.trials,
      records: productionTrialRecords({
        workloads: input.frozen.productionWorkloads,
        trials: 20,
        warmups: 3,
        failures,
        capture: async ({ pair, engine }) => {
          const row = original.find((row) => row.pair === pair && row.engine === engine)
          if (!row) throw new TypeError('Missing original fixture arm')
          return row
        },
      }),
    })
    expect(failures).toEqual([])
    expect(observed).toEqual(envelope.trialsArtifact)
    const result = await reconcileFiles({
      root: directory,
      kind: 'production',
      report: input.report.path,
      frozen: input.frozen,
      artifacts: files,
    })
    expect(result.findings).toEqual([])
    expect(result.verdict).toBe('VERIFIED')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('oracle fixture batches settle every started writer before returning a failure', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-reader-fixture-failure-'))
  try {
    const { report } = reportFixture()
    const rows = report.warmupResults.concat(report.rawTrials)
    expect(rows).toHaveLength(46)
    rows[0] = { ...rows[0], correctness: { ...rows[0].correctness, frames: [] } }
    await expect(spillFixtureOracles(directory, rows)).rejects.toThrow('unexpected final')
    const files = await readdir(directory)
    expect(files.sort()).toEqual(
      rows
        .slice(1, 8)
        .map((row) => `oracle-${row.pair}-${row.engine}.jsonl`)
        .sort(),
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('complete actual-shaped production artifacts reconcile 20 pairs and three independent warmups', async () => {
  const result = await reconcileTimingEvidence(productionInput())
  expect(result.findings).toEqual([])
  expect(result.verdict).toBe('VERIFIED')
  expect(result.timingStatus).toBe('PROMOTION_CAPTURE_RECONCILED')
  expect(result.metrics.quietHostEstablished).toBe(true)
  expect('rawReport' in result).toBe(false)
  expect(JSON.stringify(result)).not.toContain('correctness')
  expect(result.samples).toHaveLength(46)
  const oracles = result.artifacts.filter((entry) =>
    path.basename(entry.path).startsWith('oracle-'),
  )
  expect(oracles).toHaveLength(46)
  expect(new Set(oracles.map((entry) => entry.path)).size).toBe(46)
  expect(result.comparisons).toHaveLength(4)
  expect(result.comparisons.every((entry) => entry.independentTrials === 20)).toBe(true)
})

test.each(['host', 'build', 'fonts'] as const)(
  'missing %s cannot turn timing into verified evidence',
  async (key) => {
    const input = productionInput()
    const result = await reconcileTimingEvidence({
      ...input,
      artifacts: { ...input.artifacts, [key]: null },
    })
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.findings.some((entry) => entry.path === key && entry.kind === 'missing')).toBe(
      true,
    )
  },
)

test('wrong build identity and wrong report bytes fail closed', async () => {
  const input = productionInput((report) => {
    report.servedBuild.revision = 'b'.repeat(40)
  })
  expect(
    (await reconcileTimingEvidence(input)).findings.some(
      (entry) => entry.path === 'report.servedBuild',
    ),
  ).toBe(true)
  const result = await reconcileTimingEvidence({
    ...input,
    report: { ...input.report, sha256: hash('wrong') },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((entry) => entry.path.endsWith('reportSha256'))).toBe(true)
})

test('nineteen pairs and misplaced warmup rows cannot establish independent denominator', async () => {
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      report.rawTrials = report.rawTrials.filter((row) => row.pair !== 19)
    }),
  )
  expect(result.verdict).not.toBe('VERIFIED')
  expect(result.findings.some((entry) => entry.path === 'report.trialKeys')).toBe(true)
  expect(result.comparisons.every((entry) => entry.independentTrials === 19)).toBe(true)
  const misplaced = await reconcileTimingEvidence(
    productionInput((report) => {
      const row = report.warmupResults.pop()
      if (row) report.rawTrials.push(row)
    }),
  )
  expect(misplaced.findings.some((entry) => entry.path.startsWith('trials.record'))).toBe(true)
})

test('crossing-boundary worker CPU remains null with the raw exclusion reason', async () => {
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      const row = report.rawTrials[0]
      report.rawTrials[0] = {
        ...row,
        workers: { created: 1, active: 1 },
        workerCpu: [
          {
            targetId: 'worker-1',
            url: 'https://fixture.invalid/worker.js',
            threadId: 2,
            pid: 3,
            cpuMs: null,
            coveredCpuMs: 1,
            measurement: 'incomplete',
            reason: 'Task crosses trace boundary',
            taskCount: 1,
            nestedTaskCount: 0,
            incompleteTaskCount: 0,
            boundaryCrossingTaskCount: 1,
          },
        ],
      }
      report.comparisons = [
        { excludedPairs: [{ pair: 0, engine: 'remark', reason: 'raw exclusion' }] },
      ]
    }),
  )
  expect(
    result.samples.find((row) => row.pair === 0 && row.engine === 'remark')?.streamCpu,
  ).toBeNull()
  expect(result.exclusions.some((row) => row.reason === 'Task crosses trace boundary')).toBe(true)
  expect(result.rawExclusions).toEqual([[{ pair: 0, engine: 'remark', reason: 'raw exclusion' }]])
  expect(result.verdict).not.toBe('VERIFIED')
})

test('raw failures remain unchanged even if producer claims passed', async () => {
  const failure = {
    workload: 'fixture',
    reason: 'raw renderer crash',
    detail: { signal: 'SIGSEGV' },
  }
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      report.failures = [failure]
      Object.assign(report, { passed: true })
    }),
  )
  expect(result.rawFailures).toEqual([failure])
  expect(
    result.findings.some((entry) => entry.kind === 'failure' && entry.reason.includes('SIGSEGV')),
  ).toBe(true)
  expect(result.verdict).toBe('NOT VERIFIED')
})

test('instrumented reports cannot qualify', async () => {
  const instrumented = await reconcileTimingEvidence(
    productionInput((report) => {
      report.browser.actualArgs.push('--profiling')
    }),
  )
  expect(instrumented.findings.some((entry) => entry.path === 'browser.actualArgs')).toBe(true)
})
test('exploratory reports cannot qualify', async () => {
  const exploratory = await reconcileTimingEvidence(
    productionInput((report) => {
      report.capture.kind = 'exploratory'
    }),
  )
  expect(exploratory.verdict).toBe('NOT VERIFIED')
})
test('nonquiet reports cannot qualify', async () => {
  const input = productionInput()
  const quiet = JSON.parse(input.artifacts.quietHost?.contents ?? '{}')
  quiet.observations[2].ownerBusy = true
  const noisy = await reconcileTimingEvidence({
    ...input,
    artifacts: { ...input.artifacts, quietHost: artifact('quiet-host.json', quiet) },
  })
  expect(noisy.metrics.quietHostEstablished).toBeNull()
  expect(noisy.verdict).toBe('NOT VERIFIED')
})

test('input identity, painted count, transfer completion and missing ordinary latency fail closed', async () => {
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      const row = report.rawTrials[0]
      report.rawTrials[0] = {
        ...row,
        receipt: { ...row.receipt, frames: row.receipt.frames.slice(1), heldSyntax: null },
        network: row.network?.map((request) => ({ ...request, completionEncodedBytes: 1 })) ?? null,
      }
    }),
  )
  expect(result.findings.some((entry) => entry.path.endsWith('.paintRevisions'))).toBe(true)
  expect(result.findings.some((entry) => entry.path.endsWith('.heldSyntaxReleaseP95Ms'))).toBe(true)
  expect(
    result.samples.find((entry) => entry.pair === 0 && entry.engine === 'remark')?.transferredBytes,
  ).toBeNull()
})

test('native positive path retains raw warmups and compares only 20 measured pairs', async () => {
  const result = await reconcileTimingEvidence(nativeInput())
  expect(result.findings).toEqual([])
  expect(result.timingStatus).toBe('NATIVE_CAPTURE_RECONCILED')
  expect(result.metrics.configuredWarmups).toBe(3)
  expect(result.metrics.observedWarmupTrials).toBe(3)
  expect(result.samples.filter((sample) => sample.warmup)).toHaveLength(6)
  expect(result.samples.filter((sample) => !sample.warmup)).toHaveLength(40)
  expect(result.samples.filter((sample) => sample.warmup).map((sample) => sample.pair)).toEqual([
    -1, -1, -2, -2, -3, -3,
  ])
  expect(result.comparisons).toHaveLength(4)
  expect(result.comparisons.every((comparison) => comparison.independentTrials === 20)).toBe(true)
  expect(result.metrics.quietHostEstablished).toBe(true)
})

test('native producer alone does not establish quietHostEstablished', async () => {
  const input = nativeInput()
  const result = await reconcileTimingEvidence({
    ...input,
    artifacts: { ...input.artifacts, quietHost: null },
  })
  expect(result.verdict).toBe('INCONCLUSIVE')
  expect(result.timingStatus).toBe('EXPLORATORY')
  expect(result.metrics.quietHostEstablished).toBeNull()
})

test('empty native revision vectors cannot pass solely on paired output equality', async () => {
  const input = nativeInput()
  const raw = JSON.parse(input.report.contents)
  raw.workloads[0].pairs[0].candidate.revisions = []
  const report = artifact('paired-native.json', raw)
  const result = await reconcileTimingEvidence({
    ...input,
    report,
    artifacts: { ...input.artifacts, quietHost: quietArtifact(report) },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((entry) => entry.path.endsWith('.candidate.revisions'))).toBe(true)
})

test('native instrumentation cannot be blessed by a quiet host sidecar', async () => {
  const input = nativeInput()
  const host = JSON.parse(input.artifacts.quietHost?.contents ?? '{}')
  host.nativeInvocation.argv.push('--cpu-prof')
  const result = await reconcileTimingEvidence({
    ...input,
    artifacts: { ...input.artifacts, quietHost: artifact('quiet-host.json', host) },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((entry) => entry.path === 'native.invocation.instrumentation')).toBe(
    true,
  )
})

test('portable manifest entry point hashes real input files and checks actual font/build bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-reconciliation-'))
  try {
    const input = productionInput()
    const manifestPath = path.join(directory, 'manifest-input.json')
    const outputPath = path.join(directory, 'timing-reconciliation.json')
    const files = await writeFixture(directory, input)
    await writeFile(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        kind: input.kind,
        report: input.report.path,
        frozen: 'freeze.json',
        artifacts: files,
      }),
    )
    await writeFile(path.join(directory, 'freeze.json'), JSON.stringify(input.frozen))
    const result = await reconcileTimingManifest({ manifestPath, outputPath })
    expect(result.artifacts).toContainEqual({
      path: path.join(directory, input.report.path),
      sha256: hash(await readFile(path.join(directory, input.report.path), 'utf8')),
    })
    expect(
      result.findings.some((entry) => entry.reason.includes('Actual captured file bytes')),
    ).toBe(false)
    expect(JSON.parse(await readFile(outputPath, 'utf8')).verdict).toBe(result.verdict)
    // A development subset is never the CLI's frozen full producer matrix.
    expect(result.verdict).not.toBe('VERIFIED')
    await writeFile(path.join(directory, 'assets/fixture.woff2'), 'different actual bytes')
    const tampered = await reconcileTimingManifest({ manifestPath, outputPath })
    expect(
      tampered.findings.some(
        (entry) =>
          entry.path === path.join(directory, 'assets/fixture.woff2') && entry.kind === 'mismatch',
      ),
    ).toBe(true)
    const cli = spawnSync(
      'bun',
      [
        fileURLToPath(new URL('./production-reconciliation.ts', import.meta.url)),
        '--manifest',
        manifestPath,
        '--out',
        outputPath,
      ],
      { encoding: 'utf8', timeout: 30_000 },
    )
    expect(cli.error).toBeUndefined()
    expect(cli.status).toBe(1)
    expect(JSON.parse(cli.stdout).timingStatus).toBe('PROMOTION_CAPTURE_UNRECONCILED')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('warmup CPU exclusions stay raw and do not count against the 20 measured pairs', async () => {
  const input = productionInput((report) => {
    const warmup = report.warmupResults[0]
    report.warmupResults[0] = {
      ...warmup,
      streamMainThreadCpuMs: null,
      workerCpu: null,
      network: null,
      receipt: { ...warmup.receipt, heldSyntax: null, longTasks: null },
      updateCpu: [],
    }
  })
  const result = await reconcileTimingEvidence(input)
  expect(result.findings).toEqual([])
  expect(result.verdict).toBe('VERIFIED')
  expect(result.exclusions.some((entry) => entry.pair < 0 && entry.metric === 'streamCpu')).toBe(
    true,
  )
  expect(
    result.samples.find((entry) => entry.pair === -3 && entry.engine === 'tree-sitter')?.streamCpu,
  ).toBeNull()
})

test('navigation may retain unloaded unused font faces while the frozen replay awaits font readiness', async () => {
  const environment = {
    ...fontEnvironment,
    fonts: fontEnvironment.fonts.map((font) => ({ ...font, status: 'unloaded' })),
  }
  const input = productionInput((report) => {
    report.rawTrials = report.rawTrials.map((row) => ({
      ...row,
      environment: { ...row.environment, ...environment },
    }))
    report.warmupResults = report.warmupResults.map((row) => ({
      ...row,
      environment: { ...row.environment, ...environment },
    }))
  })
  const fingerprint = hash(stable({ files: fontFiles, ...environment }))
  const result = await reconcileTimingEvidence({
    ...input,
    frozen: { ...input.frozen, fontFingerprint: fingerprint },
    artifacts: {
      ...input.artifacts,
      fonts: artifact('fonts.json', {
        host: 'fixture-host',
        fingerprint,
        files: fontFiles,
        ...environment,
      }),
    },
  })
  expect(result.findings).toEqual([])
  expect(result.timingStatus).toBe('PROMOTION_CAPTURE_RECONCILED')
})

test('quiet coverage requires strictly before and after observations', async () => {
  const input = productionInput()
  const host = JSON.parse(input.artifacts.quietHost?.contents ?? '{}')
  host.observations = host.observations.filter((sample: { observedAt: string }) =>
    [instant(1), instant(5), instant(9)].includes(sample.observedAt),
  )
  const result = await reconcileTimingEvidence({
    ...input,
    artifacts: { ...input.artifacts, quietHost: artifact('quiet-host.json', host) },
  })
  expect(result.verdict).toBe('INCONCLUSIVE')
  expect(result.metrics.quietHostEstablished).toBeNull()
})

test('duplicate worker aliases cannot verify or double count transfers', async () => {
  const input = productionInput((report) => {
    const row = report.rawTrials[0]
    const page = {
      ...productionRow(0, 'remark').network![0],
      id: 'shared',
      kind: 'grammar' as const,
    }
    const worker = { ...page, target: 'worker' as const, workerTargetId: 'worker-1' }
    report.rawTrials[0] = { ...row, network: [page, worker, { ...worker }] }
  })
  const result = await reconcileTimingEvidence(input)
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((entry) => entry.reason.includes('request identity'))).toBe(true)
  expect(
    result.samples.find((row) => row.pair === 0 && row.engine === 'remark')?.transferredBytes,
  ).toBeNull()
})

test('native self-reported hashes without captured bytes remain inconclusive', async () => {
  const input = nativeInput()
  const result = await reconcileTimingEvidence({
    ...input,
    capturedFiles: [],
    artifacts: { ...input.artifacts, sourceCapture: null },
  })
  expect(result.verdict).toBe('INCONCLUSIVE')
  expect(result.findings.some((entry) => entry.path.startsWith('sourceCapture'))).toBe(true)
})

test('native frozen full closure mutation cannot retain a verified receipt', async () => {
  const input = nativeInput()
  const result = await reconcileTimingEvidence({
    ...input,
    frozen: {
      ...input.frozen,
      provenance: { ...input.frozen.provenance, sourceClosureSha256: hash('different closure') },
    },
  })
  expect(result.verdict).not.toBe('VERIFIED')
  expect(result.findings.some((entry) => entry.path.includes('sourceClosure'))).toBe(true)
})

async function writeNativeCapture(directory: string) {
  const input = nativeInput()
  const workloads = nativePairWorkloads('qualification')
  const workloadManifestSha256 = hash(
    JSON.stringify(
      workloads.map(({ source, revisions, ...entry }) => ({
        ...entry,
        sourceSha256: hash(source),
        revisionSourceSha256: revisions?.map(hash) ?? [],
      })),
    ),
  )
  const frozen = {
    identity: { ...input.frozen.identity, workloadManifestSha256 },
    provenance: input.frozen.provenance,
    fontFingerprint: input.frozen.fontFingerprint,
  }
  const raw = JSON.parse(input.report.contents)
  raw.metadata.workloadManifestSha256 = workloadManifestSha256
  async function* records() {
    for (const workload of workloads) {
      for (const pair of syntheticNativePairs(workload, raw.metadata.seed))
        yield { workload: workload.id, pair }
    }
  }
  const pairsArtifact = await writeJsonl({
    root: directory,
    file: 'raw-native-pairs.jsonl',
    records: records(),
  })
  const reportPath = path.join(directory, input.report.path)
  const report = artifact(reportPath, {
    ...raw,
    schemaVersion: 2,
    pairsArtifact,
    workloads: workloads.map((workload) => ({
      id: workload.id,
      family: workload.family,
      sourceBytes: workload.sourceBytes,
      sourceSha256: hash(workload.source),
      scheduleUnits: workload.scheduleUnits,
      observedPairs: 20,
      mismatchedPairs: 0,
      comparisons: nativeComparisons(workload.id, raw.metadata.seed),
    })),
  })
  await writeFile(reportPath, report.contents)
  const capture = JSON.parse(input.artifacts.sourceCapture?.contents ?? '{}')
  capture.reportSha256 = report.sha256
  const artifacts = {
    ...input.artifacts,
    quietHost: quietArtifact({ ...report, path: input.report.path }),
    trials: null,
    sourceCapture: artifact('source-capture.json', capture),
  }
  const files = Object.fromEntries(
    Object.entries(artifacts).map(([key, value]) => [key, value?.path ?? null]),
  )
  files.trials = pairsArtifact.path
  for (const value of Object.values(artifacts).filter((value) => value !== null))
    await writeFile(path.join(directory, value.path), value.contents)
  for (const value of input.capturedFiles ?? []) {
    await mkdir(path.dirname(path.join(directory, value.path)), { recursive: true })
    await writeFile(path.join(directory, value.path), value.bytes)
  }
  const manifestPath = path.join(directory, 'manifest-input.json')
  const outputPath = path.join(directory, 'timing-reconciliation.json')
  await writeFile(
    manifestPath,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'native',
      report: input.report.path,
      frozen: 'freeze.json',
      artifacts: files,
    }),
  )
  await writeFile(path.join(directory, 'freeze.json'), JSON.stringify(frozen))
  return { frozen, manifestPath, outputPath }
}
async function nativeCliSummary(manifestPath: string, outputPath: string) {
  const cli = spawnSync(
    'bun',
    [
      fileURLToPath(new URL('./production-reconciliation.ts', import.meta.url)),
      '--manifest',
      manifestPath,
      '--out',
      outputPath,
    ],
    { encoding: 'utf8', timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
  )
  expect(cli.error).toBeUndefined()
  expect(cli.stderr).toBe('')
  const result = JSON.parse(await readFile(outputPath, 'utf8'))
  return {
    verdict: result.verdict,
    findings: result.findings,
    timingStatus: result.timingStatus,
    exit: cli.status,
    measured: result.samples.filter((sample: { warmup: boolean }) => !sample.warmup).length,
    warmup: result.samples.filter((sample: { warmup: boolean }) => sample.warmup).length,
    comparisons: result.comparisons.length,
    metrics: result.metrics,
  }
}
test('full native CLI verifies actual source closure and binary bytes then rejects mutations and missing bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-reconciliation-native-'))
  try {
    const { frozen, manifestPath, outputPath } = await writeNativeCapture(directory)
    const positive = await nativeCliSummary(manifestPath, outputPath)
    expect(positive.verdict).toBe('VERIFIED')
    expect(positive.exit).toBe(0)
    expect(positive.findings).toEqual([])
    expect(positive.timingStatus).toBe('NATIVE_CAPTURE_RECONCILED')
    expect(positive.measured).toBe(3000)
    expect(positive.warmup).toBe(450)
    expect(positive.metrics.observedWarmupTrials).toBe(225)
    expect(positive.comparisons).toBe(300)
    console.log('SYNTHETIC_FULL_NATIVE', JSON.stringify(positive))
    const source = path.join(
      directory,
      'snapshot/apps/web/src/features/chat/providers/full-only.ts',
    )
    await writeFile(source, 'mutated full closure source')
    const mutation = await nativeCliSummary(manifestPath, outputPath)
    expect(mutation.verdict).toBe('NOT VERIFIED')
    expect(
      mutation.findings.some(
        (entry: { path: string; kind: string }) =>
          entry.path.includes('full-only.ts') && entry.kind === 'mismatch',
      ),
    ).toBe(true)
    await writeFile(source, 'full closure source')
    await writeFile(
      path.join(directory, 'freeze.json'),
      JSON.stringify({
        ...frozen,
        provenance: { ...frozen.provenance, sourceClosureSha256: hash('mutated sealed closure') },
      }),
    )
    const closure = await nativeCliSummary(manifestPath, outputPath)
    expect(closure.verdict).toBe('NOT VERIFIED')
    expect(
      closure.findings.some((entry: { path: string }) =>
        entry.path.includes('sourceClosureSha256'),
      ),
    ).toBe(true)
    await writeFile(path.join(directory, 'freeze.json'), JSON.stringify(frozen))
    await rm(path.join(directory, 'grammar.wasm'))
    const missing = await nativeCliSummary(manifestPath, outputPath)
    expect(missing.verdict).toBe('INCONCLUSIVE')
    expect(
      missing.findings.some(
        (entry: { path: string; kind: string }) =>
          entry.path.endsWith('grammar.wasm') && entry.kind === 'missing',
      ),
    ).toBe(true)
    await rm(path.join(directory, 'source-capture.json'))
    expect((await nativeCliSummary(manifestPath, outputPath)).verdict).toBe('INCONCLUSIVE')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 360_000)

test.each(['duplicate-page', 'ambiguous-workers', 'shared-worker-alias'] as const)(
  'rejects %s request identity ambiguity',
  async (scenario) => {
    const input = productionInput((report) => {
      const row = report.rawTrials[0]
      const base = row.network?.[0]
      if (!base) throw new Error('Missing transfer fixture')
      const page = { ...base, id: 'shared', kind: 'grammar' as const }
      const worker = { ...page, target: 'worker' as const, workerTargetId: 'worker-1' }
      let network = [page, worker]
      if (scenario === 'duplicate-page') network = network.concat([{ ...page }])
      if (scenario === 'ambiguous-workers')
        network = network.concat([{ ...worker, workerTargetId: 'worker-2' }])
      if (scenario === 'shared-worker-alias')
        network = [
          { ...page, resolvedByWorkerRequestId: 'shared' },
          { ...page, id: 'other-page', resolvedByWorkerRequestId: 'shared' },
          worker,
        ]
      report.rawTrials[0] = { ...row, network }
    })
    const result = await reconcileTimingEvidence(input)
    expect(result.verdict).toBe('NOT VERIFIED')
    expect(result.findings.some((entry) => entry.reason.includes('request identity'))).toBe(true)
    expect(
      result.samples.find((row) => row.pair === 0 && row.engine === 'remark')?.transferredBytes,
    ).toBeNull()
  },
)

test('native missing file bytes and empty producer source list cannot pass the pure route', async () => {
  const input = nativeInput()
  const missing = await reconcileTimingEvidence({ ...input, capturedFiles: [] })
  expect(missing.verdict).toBe('INCONCLUSIVE')
  expect(
    missing.findings.filter((entry) => entry.path.startsWith('sourceCapture.bytes.')),
  ).toHaveLength(10)
  const raw = JSON.parse(input.report.contents)
  raw.metadata.sourceFiles = []
  raw.metadata.candidateSourceSha256 = hash(JSON.stringify([]))
  const report = artifact(input.report.path, raw)
  const sourceCapture = JSON.parse(input.artifacts.sourceCapture?.contents ?? '{}')
  sourceCapture.reportSha256 = report.sha256
  const empty = await reconcileTimingEvidence({
    ...input,
    report,
    frozen: input.frozen,
    artifacts: {
      ...input.artifacts,
      quietHost: quietArtifact(report),
      sourceCapture: artifact('source-capture.json', sourceCapture),
    },
  })
  expect(empty.verdict).toBe('INCONCLUSIVE')
  expect(
    empty.findings.some(
      (entry) => entry.path === 'sourceCapture.native.sourceFiles' && entry.kind === 'missing',
    ),
  ).toBe(true)
})

test('native narrow producer hash stays distinct from the final full candidate closure', async () => {
  const input = nativeInput()
  const result = await reconcileTimingEvidence({
    ...input,
    frozen: {
      ...input.frozen,
      identity: {
        ...input.frozen.identity,
        candidateSourceSha256: input.frozen.provenance.sourceClosureSha256,
      },
    },
  })
  expect(result.findings).toEqual([])
  expect(result.verdict).toBe('VERIFIED')
})

test('actual reader rejects reuse of an earlier arm oracle after raw and envelope rehash', async () => {
  const result = await mutateFileFixture({
    kind: 'production',
    rebind: true,
    mutate(lines) {
      const earlier: ProductionTrial = JSON.parse(lines[0])
      return changedProductionLine(lines, 45, (row) => ({
        ...row,
        correctness: earlier.correctness,
        freshCompleted: earlier.freshCompleted,
      }))
    },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path.endsWith('.oraclePath'))).toBe(true)
})

const invalidControls: readonly { readonly name: string; readonly controls: unknown }[] = [
  { name: 'missing record', controls: undefined },
  { name: 'null record', controls: null },
  { name: 'empty record', controls: {} },
  { name: 'missing known-good output', controls: { ...fixtureControls(), knownGood: {} } },
  {
    name: 'wrong known-good output',
    controls: {
      ...fixtureControls(),
      knownGood: { ...fixtureControls().knownGood, observed: hash('wrong output') },
    },
  },
  {
    name: 'malformed matching output digests',
    controls: {
      ...fixtureControls(),
      knownGood: { ...fixtureControls().knownGood, expected: 'wrong', observed: 'wrong' },
    },
  },
  {
    name: 'wrong known-good revision',
    controls: {
      ...fixtureControls(),
      knownGood: { ...fixtureControls().knownGood, observedRevision: 1 },
    },
  },
  {
    name: 'unobserved matching revisions',
    controls: {
      ...fixtureControls(),
      knownGood: { ...fixtureControls().knownGood, revision: 0, observedRevision: 0 },
    },
  },
  {
    name: 'accepted missing expectation',
    controls: {
      ...fixtureControls(),
      missingExpectation: { rejected: false, reason: 'Missing expectation accepted' },
    },
  },
  {
    name: 'accepted wrong expectation',
    controls: {
      ...fixtureControls(),
      wrongExpectation: { rejected: false, reason: 'Wrong output accepted' },
    },
  },
  {
    name: 'missing rejection evidence',
    controls: { ...fixtureControls(), wrongExpectation: { rejected: true, reason: null } },
  },
  {
    name: 'empty rejection evidence',
    controls: { ...fixtureControls(), missingExpectation: { rejected: true, reason: '  ' } },
  },
  {
    name: 'malformed rejection result',
    controls: { ...fixtureControls(), wrongExpectation: { rejected: 'true', reason: 'Rejected' } },
  },
  {
    name: 'unsupported long-task observation',
    controls: { ...fixtureControls(), longTask: { supported: false, observed: [80] } },
  },
  {
    name: 'missing long-task observations',
    controls: { ...fixtureControls(), longTask: { supported: true, observed: null } },
  },
  {
    name: 'empty long-task observations',
    controls: { ...fixtureControls(), longTask: { supported: true, observed: [] } },
  },
  {
    name: 'no detected long task',
    controls: { ...fixtureControls(), longTask: { supported: true, observed: [49, 50] } },
  },
  {
    name: 'invalid long-task duration',
    controls: { ...fixtureControls(), longTask: { supported: true, observed: [-1, 80] } },
  },
]

test.each(invalidControls)(
  'promotion controls reject $name despite an empty producer failure summary',
  async ({ controls }) => {
    const input = productionInput((report) => {
      Reflect.set(report, 'controls', controls)
    })
    const result = await reconcileTimingEvidence(input)
    expect(result.rawFailures).toEqual([])
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.timingStatus).toBe('PROMOTION_CAPTURE_UNRECONCILED')
    expect(result.findings.some((entry) => entry.path.startsWith('report.controls'))).toBe(true)
  },
)

test('promotion controls retain a detected long task among short observations', async () => {
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      report.controls.longTask.observed = [0, 49, 50, 80]
    }),
  )
  expect(result.findings).toEqual([])
  expect(result.verdict).toBe('VERIFIED')
})

test.each([
  { name: 'missing first warmup', index: 0, replacement: null },
  { name: 'missing middle warmup', index: 1, replacement: null },
  { name: 'missing last warmup', index: 2, replacement: null },
  { name: 'duplicate warmup', index: 1, replacement: -1 },
  { name: 'unexpected negative ID', index: 0, replacement: -4 },
  { name: 'fractional warmup ID', index: 0, replacement: -1.5 },
  { name: 'measured ID substituted for warmup', index: 0, replacement: 0 },
])('actual native raw rejects $name after rehash', async ({ index, replacement }) => {
  const result = await mutateFileFixture({
    kind: 'native',
    rebind: true,
    mutate: (lines) => {
      if (replacement === null) return lines.filter((_, line) => line !== index)
      const row = JSON.parse(lines[index])
      row.pair.trial = replacement
      row.pair.remark.trial = replacement
      row.pair.candidate.trial = replacement
      lines[index] = JSON.stringify(row)
      return lines
    },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path.startsWith('trials.record.'))).toBe(true)
})

test('actual native raw rejects an extra warmup after rehash', async () => {
  const result = await mutateFileFixture({
    kind: 'native',
    rebind: true,
    mutate: (lines) => [lines[0]].concat(lines),
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path === 'native.pairKeys')).toBe(true)
  expect(result.metrics.observedWarmupTrials).toBe(4)
})

test.each(['remark', 'candidate'] as const)(
  'actual native warmup validates %s arm identity after rehash',
  async (arm) => {
    const result = await mutateFileFixture({
      kind: 'native',
      rebind: true,
      mutate: (lines) => {
        const row = JSON.parse(lines[0])
        row.pair[arm].trial = 0
        lines[0] = JSON.stringify(row)
        return lines
      },
    })
    expect(result.verdict).toBe('NOT VERIFIED')
    expect(result.findings.some((finding) => finding.path.endsWith('.identity'))).toBe(true)
  },
)

test.each([
  { name: 'order', field: 'order', expected: '.order' },
  { name: 'missing revisions', field: 'revisions', expected: '.candidate.revisions' },
  { name: 'wrong output', field: 'outputDigest', expected: '.outputs' },
  { name: 'source coordinates', field: 'sourceCoordinateFailures', expected: '.sourceCoordinates' },
  { name: 'revision identity', field: 'offset', expected: '.candidate.revisions' },
  { name: 'reported mismatch', field: 'mismatchedRevisions', expected: '.mismatchedRevisions' },
])('actual native warmup rejects $name hidden by a clean summary', async ({ field, expected }) => {
  const result = await mutateFileFixture({
    kind: 'native',
    rebind: true,
    mutate: (lines) => {
      const row = JSON.parse(lines[2])
      if (field === 'order') row.pair.order.reverse()
      if (field === 'revisions') row.pair.candidate.revisions = []
      if (field === 'outputDigest') row.pair.candidate.revisions[0].outputDigest = hash('wrong')
      if (field === 'sourceCoordinateFailures')
        row.pair.candidate.revisions[0].sourceCoordinateFailures = ['out of bounds']
      if (field === 'offset') row.pair.candidate.revisions[0].offset++
      if (field === 'mismatchedRevisions') row.pair.mismatchedRevisions = [0]
      lines[2] = JSON.stringify(row)
      return lines
    },
  })
  expect(result.verdict).toBe('NOT VERIFIED')
  expect(result.findings.some((finding) => finding.path.endsWith(expected))).toBe(true)
  if (field !== 'order')
    expect(result.findings.some((finding) => finding.path.endsWith('.mismatchedPairs'))).toBe(true)
  expect(result.comparisons.every((comparison) => comparison.independentTrials === 20)).toBe(true)
})

async function writeProductionShardFixture(directory: string, indices?: readonly number[]) {
  const workload = productionBrowserWorkloads().find(
    (entry) => entry.id === 'cold-mount-plain-paragraph',
  )
  if (!workload) throw new TypeError('Missing cold production workload')
  const baseInput = productionInput(() => {}, workload)
  const original = JSON.parse(baseInput.report.contents)
  const sources = [
    { file: 'scripts/markdown/production-browser.ts', sha256: hash('fixture producer') },
  ]
  const sourceClosureSha256 = hash(JSON.stringify(sources))
  const input = {
    ...baseInput,
    frozen: {
      ...baseInput.frozen,
      provenance: { ...baseInput.frozen.provenance, sourceClosureSha256 },
      identity: { ...baseInput.frozen.identity, candidateSourceSha256: sourceClosureSha256 },
    },
  }
  original.provenance.sources = sources
  original.provenance.sourceClosureSha256 = sourceClosureSha256
  original.servedBuild.sourceClosureSha256 = sourceClosureSha256
  const build = JSON.parse(input.artifacts.build?.contents ?? '{}')
  build.sourceBefore = input.frozen.provenance
  build.sourceAfter = input.frozen.provenance
  const fixtureInput = {
    ...input,
    artifacts: {
      ...input.artifacts,
      build: artifact('markdown-probe-build.json', build),
      sourceCapture: artifact('source-capture.json', {
        reportSha256: input.report.sha256,
        sourceRoot: 'source',
        provenance: { ...input.frozen.provenance, sources },
        files: {
          lockfile: 'bun.lock',
          grammar: 'assets/tree-sitter-markdown.wasm',
          chatGrammar: 'assets/tree-sitter-markdown-chat.wasm',
          resolver: 'assets/tree-sitter-md.wasm',
          budget: 'promotion-budget.json',
        },
      }),
    },
    capturedFiles: [
      {
        path: 'source/scripts/markdown/production-browser.ts',
        bytes: new TextEncoder().encode('fixture producer'),
      },
      { path: 'bun.lock', bytes: new TextEncoder().encode('lock') },
      { path: 'promotion-budget.json', bytes: new TextEncoder().encode('budget') },
    ],
  }
  const plan = {
    schemaVersion: 1,
    kind: 'production-capture-plan',
    purpose: 'promotion',
    provenance: original.provenance,
    budgetSha256: input.frozen.identity.budgetSha256,
    build: {
      metadataSha256: fixtureInput.artifacts.build.sha256,
      manifestSha256: input.artifacts.buildManifest?.sha256,
    },
    workloadManifest: original.workloadManifest,
    shards: Array.from({ length: 23 }, (_, index) => ({
      workload: workload.id,
      pair: index - 3,
    })),
  }
  const planFile = artifact('capture-plan.json', plan)
  await writeFile(path.join(directory, planFile.path), planFile.contents)
  const selections = Array.from(plan.shards.entries()).filter(
    ([index]) => !indices || indices.includes(index),
  )
  const shards = await Promise.all(
    selections.map(async ([index, selection]) => {
      const folder = path.join(directory, `shard-${index}`)
      await mkdir(folder)
      const report = {
        ...original,
        shard: {
          ...selection,
          index,
          planSha256: planFile.sha256,
          launchId: `launch-${index}`,
        },
        rawTrials: original.rawTrials.filter((row: ProductionTrial) => row.pair === selection.pair),
        warmupResults: original.warmupResults.filter(
          (row: ProductionTrial) => row.pair === selection.pair,
        ),
        comparisons: [],
      }
      report.host = JSON.parse(JSON.stringify(original.host))
      report.host.before.observedAt = instant(index * 20 + 1)
      report.host.after.observedAt = instant(index * 20 + 9)
      report.browser = {
        ...original.browser,
        actualArgs: original.browser.actualArgs.map((arg: string) =>
          arg.startsWith('--user-data-dir=') ? `--user-data-dir=/fixture/profile-${index}` : arg,
        ),
      }
      const files = await writeFixture(folder, {
        ...fixtureInput,
        report: artifact(input.report.path, report),
      })
      const filename = path.join(folder, input.report.path)
      const compact = JSON.parse(await readFile(filename, 'utf8'))
      const trials: ProductionTrial[] = (
        await readFile(path.join(folder, 'raw-production-trials.jsonl'), 'utf8')
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      compact.comparisons = productionComparisons(
        trials.filter((row) => row.pair >= 0).map(productionMetricObservation),
        input.frozen.productionWorkloads,
      )
      const actual = artifact(input.report.path, compact)
      await writeFile(filename, actual.contents)
      const quiet = JSON.parse(await readFile(path.join(folder, files.quietHost ?? ''), 'utf8'))
      quiet.reportSha256 = actual.sha256
      quiet.observations = [0, 1, 5, 9, 10].map((seconds) => ({
        ...quiet.observations[0],
        observedAt: instant(index * 20 + seconds),
      }))
      await writeFile(path.join(folder, files.quietHost ?? ''), JSON.stringify(quiet))
      const browser = JSON.parse(await readFile(path.join(folder, files.browser ?? ''), 'utf8'))
      browser.args = report.browser.actualArgs
      await writeFile(path.join(folder, files.browser ?? ''), JSON.stringify(browser))
      const source = JSON.parse(
        await readFile(path.join(folder, files.sourceCapture ?? ''), 'utf8'),
      )
      source.reportSha256 = actual.sha256
      await writeFile(path.join(folder, files.sourceCapture ?? ''), JSON.stringify(source))
      return {
        report: { path: `shard-${index}/${actual.path}`, sha256: actual.sha256 },
        artifacts: files,
      }
    }),
  )
  const index = {
    schemaVersion: 1,
    kind: 'production-shards',
    plan: { path: planFile.path, sha256: planFile.sha256 },
    shards,
  }
  const writeIndex = () =>
    writeFile(path.join(directory, 'production-shards.json'), JSON.stringify(index))
  await writeIndex()
  const read = async () =>
    reconcileFiles({
      root: directory,
      kind: 'production',
      report: 'production-shards.json',
      frozen: input.frozen,
      artifacts: {
        host: null,
        quietHost: null,
        build: null,
        buildManifest: null,
        browser: null,
        fonts: null,
        sourceCapture: null,
        trials: 'production-shards.json',
      },
    })
  return { index, read, writeIndex, frozen: input.frozen }
}

test('bounded production shards reconcile separate launches before the exact twenty-pair comparison', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-shard-reader-'))
  try {
    const fixture = await writeProductionShardFixture(directory)
    const result = await fixture.read()
    expect(result.findings).toEqual([])
    expect(result.verdict).toBe('VERIFIED')
    expect(result.samples).toHaveLength(46)
    expect(result.productionSummary?.provenance).toEqual(
      JSON.parse(await readFile(path.join(directory, 'capture-plan.json'), 'utf8')).provenance,
    )
    expect(result.productionSummary?.familyCoverage).toContainEqual({
      family: fixture.frozen.productionWorkloads[0].family,
      selectedCells: 1,
      pairedObservedCells: 1,
      status: 'EXPLORATORY',
    })
    expect(result.productionSummary?.failures).toEqual([])
    expect(result.comparisons).toHaveLength(4)
    expect(result.comparisons.every((row) => row.independentTrials === 20)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('assembly rejects missing warmup and measured shard coverage', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-shard-missing-'))
  try {
    const fixture = await writeProductionShardFixture(directory, [0])
    const missing = await fixture.read()
    expect(missing.verdict).not.toBe('VERIFIED')
    expect(missing.findings.some((row) => row.path === 'shardCoverage')).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each([
  { name: 'duplicate launch', change: 'duplicate', expected: 'shards.1.launchId' },
  { name: 'report hash', change: 'hash', expected: 'report.sha256' },
  { name: 'changed plan', change: 'plan', expected: 'planSha256' },
  { name: 'wrong pair selection', change: 'pair', expected: 'selection' },
  { name: 'another browser profile', change: 'profile', expected: 'browser.args' },
  { name: 'changed runtime cohort', change: 'runtime', expected: 'cohort' },
  { name: 'failed controls', change: 'control', expected: 'controls.knownGood' },
  { name: 'retained launch failure', change: 'failure', expected: 'report.failures.0' },
  { name: 'missing pair arm', change: 'arm', expected: 'report.trialKeys' },
  { name: 'mutated source bytes', change: 'source', expected: 'sourceCapture.bytes' },
  { name: 'copied quiet receipt', change: 'quiet', expected: 'quietHost.reportSha256' },
])('shard assembly rejects $name', async ({ change, expected }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-shard-reject-'))
  try {
    const fixture = await writeProductionShardFixture(directory, [0, 1])
    const entry = fixture.index.shards[1]
    const filename = path.join(directory, entry.report.path)
    const report = JSON.parse(await readFile(filename, 'utf8'))
    if (change === 'duplicate') report.shard.launchId = 'launch-0'
    if (change === 'hash') entry.report.sha256 = hash('changed report')
    if (change === 'plan') report.shard.planSha256 = hash('changed plan')
    if (change === 'pair') report.shard.pair = -3
    if (change === 'profile') report.browser.actualArgs = ['another actual browser profile']
    if (change === 'runtime') report.provenance.runtime.bun = 'changed runtime'
    if (change === 'control') report.controls.knownGood.observed = 'wrong control'
    if (change === 'failure') report.failures = ['original launch failure']
    if (change === 'source')
      await writeFile(
        path.join(directory, 'shard-1/source/scripts/markdown/production-browser.ts'),
        'changed bytes',
      )
    if (change === 'quiet')
      await writeFile(
        path.join(directory, 'shard-1/quiet-host.json'),
        await readFile(path.join(directory, 'shard-0/quiet-host.json')),
      )
    if (change === 'arm') {
      const trialFile = path.join(directory, 'shard-1/raw-production-trials.jsonl')
      const line = (await readFile(trialFile, 'utf8')).trim().split('\n')[0] + '\n'
      await writeFile(trialFile, line)
      report.trialsArtifact = {
        ...report.trialsArtifact,
        recordCount: 1,
        byteLength: Buffer.byteLength(line),
        sha256: hash(line),
      }
    }
    await writeFile(filename, JSON.stringify(report))
    if (change !== 'hash') entry.report.sha256 = hash(JSON.stringify(report))
    await fixture.writeIndex()
    const result = await fixture.read()
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.findings.some((row) => row.path.includes(expected))).toBe(true)
    if (change === 'failure')
      expect(JSON.stringify(result.rawFailures)).toContain('original launch failure')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('shard packaging retains original reports and report-relative sidecars without inventing a launch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-shard-package-'))
  try {
    const fixture = await writeProductionShardFixture(directory)
    const frozenFile = path.join(directory, 'frozen.json')
    await writeFile(frozenFile, JSON.stringify(fixture.frozen))
    const manifests = []
    for (const [index, entry] of fixture.index.shards.entries()) {
      const filename = path.join(directory, `shard-${index}`, 'timing-manifest.json')
      await writeFile(
        filename,
        JSON.stringify({
          schemaVersion: 1,
          kind: 'production',
          report: 'production-browser.json',
          frozen: '../frozen.json',
          artifacts: entry.artifacts,
        }),
      )
      manifests.push(filename)
    }
    const packaged = await assembleTimingShards({
      root: directory,
      planFile: 'capture-plan.json',
      frozenFile,
      launchManifests: manifests.toReversed(),
      output: path.join(directory, 'assembly'),
    })
    const index = JSON.parse(await readFile(packaged.indexFile, 'utf8'))
    expect(index.shards).toHaveLength(23)
    expect(index.shards[0].report.sha256).toBe(fixture.index.shards[0].report.sha256)
    expect(index.shards[0].report.path).toBe('../shard-0/production-browser.json')
    expect(index.shards[0].artifacts).toEqual(fixture.index.shards[0].artifacts)
    expect(index).not.toHaveProperty('browser')
    await expect(
      assembleTimingShards({
        root: directory,
        planFile: 'capture-plan.json',
        frozenFile,
        launchManifests: manifests.slice(1),
        output: path.join(directory, 'incomplete'),
      }),
    ).rejects.toThrow('every planned shard exactly once')
    await expect(
      assembleTimingShards({
        root: directory,
        planFile: 'capture-plan.json',
        frozenFile,
        launchManifests: manifests.concat([manifests[0]]),
        output: path.join(directory, 'duplicate'),
      }),
    ).rejects.toThrow('distinct actual launch identity')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('launch artifact finalization retains actual source/assets and rejects changed source bytes', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'production-launch-artifacts-'))
  try {
    const fixture = await writeProductionShardFixture(directory, [0])
    const launch = path.join(directory, 'shard-0')
    const source = path.join(launch, 'source')
    await writeFile(path.join(source, 'bun.lock'), 'lock')
    await writeFile(path.join(source, 'scripts/markdown/promotion-budget.json'), 'budget')
    await mkdir(path.join(launch, '.vite'))
    await writeFile(
      path.join(launch, '.vite/manifest.json'),
      await readFile(path.join(launch, 'manifest.json')),
    )
    const frozen = path.join(directory, 'frozen.json')
    await writeFile(frozen, JSON.stringify(fixture.frozen))
    const original = await readFile(path.join(launch, 'production-browser.json'))
    const options = {
      root: directory,
      report: path.join(launch, 'production-browser.json'),
      build: launch,
      source,
      snapshot: 'retained-source',
      frozen,
      host: path.join(launch, 'host.json'),
      quietHost: path.join(launch, 'quiet-host.json'),
      output: 'launch-sidecars',
    }
    const finalized = await finalizeProductionLaunch(options)
    const manifest = JSON.parse(await readFile(finalized.manifestFile, 'utf8'))
    expect(manifest.report).toBe('../shard-0/production-browser.json')
    expect(manifest.artifacts.build).toBe('../shard-0/markdown-probe-build.json')
    expect(finalized.fontFingerprint).toBe(fixture.frozen.fontFingerprint)
    expect(await readFile(path.join(launch, 'production-browser.json'))).toEqual(original)
    expect(
      await readFile(
        path.join(directory, 'retained-source/scripts/markdown/production-browser.ts'),
        'utf8',
      ),
    ).toBe('fixture producer')
    const browser = JSON.parse(
      await readFile(path.join(directory, 'launch-sidecars/browser.json'), 'utf8'),
    )
    expect(browser.args).toEqual(JSON.parse(original.toString()).browser.actualArgs)
    await writeFile(path.join(source, 'scripts/markdown/production-browser.ts'), 'changed source')
    await expect(
      finalizeProductionLaunch({ ...options, output: 'changed-sidecars' }),
    ).rejects.toThrow('Source changed after the actual capture')
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

async function writeNativeShardFixture(directory: string, indices?: readonly number[]) {
  const input = nativeInput()
  const original = JSON.parse(input.report.contents)
  const sourceCapture = JSON.parse(input.artifacts.sourceCapture?.contents ?? '{}')
  const qualification = {
    ...input.frozen.provenance,
    sources: sourceCapture.provenance.sources,
    runtime: { bun: '1.3.fixture', node: '24.fixture', platform: 'darwin', architecture: 'arm64' },
    curatedSources: [],
    reference: { assets: [] },
    baselineProfile: { id: 'fixture' },
  }
  const metadata = { ...original.metadata, qualification, runtime: 'node v24.fixture' }
  const plan = {
    schemaVersion: 1,
    kind: 'native-capture-plan',
    purpose: 'qualification',
    metadata: Object.fromEntries(
      [
        'seed',
        'candidateCommit',
        'candidateSourceSha256',
        'sourceFiles',
        'lockfileSha256',
        'budgetSha256',
        'grammarSha256',
        'chatGrammarSha256',
        'resolverSha256',
        'workloadManifestSha256',
        'qualification',
      ].map((key) => [key, metadata[key]]),
    ),
    shards: [-1, -2, -3]
      .concat(Array.from({ length: 20 }, (_, pair) => pair))
      .map((pair) => ({ workload: nativeWorkload.id, pair })),
  }
  const planFile = artifact('native-plan.json', plan)
  await writeFile(path.join(directory, planFile.path), planFile.contents)
  const shards = await Promise.all(
    Array.from(plan.shards.entries())
      .filter(([index]) => !indices || indices.includes(index))
      .map(async ([index, selection]) => {
        const folder = path.join(directory, `native-${index}`)
        await mkdir(folder)
        const preparation = pairedTrialOrders(3, metadata.seed).map((order, preparation) => ({
          role: 'launch-preparation',
          preparation,
          workload: nativeWorkload.id,
          pair: {
            trial: preparation,
            order,
            remark: syntheticNativeTrial(nativeWorkload, preparation, 'remark'),
            candidate: syntheticNativeTrial(nativeWorkload, preparation, 'tree-sitter'),
            mismatchedRevisions: [],
          },
        }))
        const contents = preparation.map((row) => JSON.stringify(row)).join('\n') + '\n'
        await writeFile(path.join(folder, 'raw-native-preparation.jsonl'), contents)
        const report = {
          ...original,
          shard: {
            ...selection,
            index,
            planSha256: planFile.sha256,
            launchId: `native-launch-${index}`,
          },
          metadata: {
            ...metadata,
            startedAt: instant(index * 20 + 1),
            finishedAt: instant(index * 20 + 9),
            initialization: {
              startedAt: instant(index * 20 + 1),
              finishedAt: instant(index * 20 + 2),
              durationMs: 1000,
            },
            launchPreparation: {
              policy: 'paired-full-workload-three-replays-v1',
              realm: 'fresh Bun process per launch; shared module/parser/JIT caches within launch',
              sessions: 'fresh session/HAST processor/projection WeakMap per arm',
              gc: 'no forced GC',
              startedAt: instant(index * 20 + 2),
              finishedAt: instant(index * 20 + 8),
              durationMs: 6000,
              pairs: 3,
              arms: 6,
              trialIds: [0, 1, 2],
              orderSeed: metadata.seed,
              mismatchedPairs: 0,
              artifact: {
                path: 'raw-native-preparation.jsonl',
                sha256: hash(contents),
                byteLength: Buffer.byteLength(contents),
                recordCount: 3,
              },
            },
          },
          workloads: original.workloads.map((row: { pairs: { trial: number }[] }) => ({
            ...row,
            pairs: row.pairs.filter((pair) => pair.trial === selection.pair),
          })),
        }
        const files = await writeFixture(folder, {
          ...input,
          report: artifact(input.report.path, report),
        })
        const filename = path.join(folder, input.report.path)
        const compact = JSON.parse(await readFile(filename, 'utf8'))
        compact.workloads[0].comparisons =
          selection.pair < 0
            ? []
            : (['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const).map((metric) => ({
                ...pairedConfidence({
                  workload: nativeWorkload.id,
                  metric,
                  seed: metadata.seed,
                  resamples: 4096,
                  baseline: [metric === 'streamCpu' ? 2 : 1],
                  candidate: [metric === 'streamCpu' ? 2 : 1],
                }),
                domain: 'native',
                build: 'source',
              }))
        await writeFile(filename, JSON.stringify(compact))
        for (const key of ['quietHost', 'sourceCapture'] as const) {
          const file = files[key]
          if (!file) expect.fail(`Missing ${key}`)
          const sidecarPath = path.join(folder, file)
          const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'))
          sidecar.reportSha256 = hash(JSON.stringify(compact))
          if (key === 'quietHost') {
            sidecar.nativeInvocation.runtime = metadata.runtime
            sidecar.nativeInvocation.reportPath = `native-${index}/${input.report.path}`
            sidecar.observations = [0, 1, 5, 9, 10].map((seconds) => ({
              ...sidecar.observations[0],
              observedAt: instant(index * 20 + seconds),
            }))
            sidecar.nativeInvocation.argv = sidecar.nativeInvocation.argv.concat([
              '--capture-plan',
              path.join(directory, planFile.path),
              '--selection-index',
              String(index),
              '--launch-id',
              report.shard.launchId,
            ])
          }
          await writeFile(sidecarPath, JSON.stringify(sidecar))
        }
        return {
          report: {
            path: `native-${index}/${input.report.path}`,
            sha256: hash(JSON.stringify(compact)),
          },
          artifacts: files,
        }
      }),
  )
  const index = {
    schemaVersion: 1,
    kind: 'native-shards',
    plan: { path: planFile.path, sha256: planFile.sha256 },
    shards,
  }
  const writeIndex = () =>
    writeFile(path.join(directory, 'native-shards.json'), JSON.stringify(index))
  await writeIndex()
  const read = () =>
    reconcileFiles({
      root: directory,
      kind: 'native',
      report: 'native-shards.json',
      frozen: input.frozen,
      artifacts: {
        host: null,
        quietHost: null,
        build: null,
        buildManifest: null,
        browser: null,
        fonts: null,
        sourceCapture: null,
        trials: 'native-shards.json',
      },
    })
  return { index, read, writeIndex }
}

test('native shard reader reconciles 23 original launches and excludes preparation from counted coverage', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-shard-reader-'))
  try {
    const fixture = await writeNativeShardFixture(directory)
    const result = await fixture.read()
    expect(result.findings).toEqual([])
    expect(result.verdict).toBe('VERIFIED')
    expect(result.samples).toHaveLength(46)
    expect(result.metrics.observedWarmupTrials).toBe(3)
    expect(result.metrics.quietHostEstablished).toBe(true)
    expect(result.comparisons).toHaveLength(4)
    expect(result.comparisons.every((row) => row.independentTrials === 20)).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.each([
  { change: 'missingPlanArgument', expected: 'native.invocation.capturePlan' },
  { change: 'duplicatePlanArgument', expected: 'native.invocation.capturePlan' },
  { change: 'absoluteReportPath', expected: 'native.invocation.reportPath' },
  { change: 'otherReportPath', expected: 'native.invocation.reportPath' },
  { change: 'duplicateLaunch', expected: 'shards.1.launchId' },
  { change: 'missingWarmup', expected: 'native.shardCoverage' },
  { change: 'runtime', expected: 'shards.1.runtime' },
  { change: 'source', expected: 'shards.1.metadata' },
  { change: 'copiedQuiet', expected: 'native.host.reportSha256' },
  { change: 'preparationOutput', expected: 'native.preparation.correctness' },
  { change: 'preparationCoordinate', expected: 'sourceCoordinates' },
  { change: 'preparationIdentity', expected: '.tree-sitter.identity' },
  { change: 'preparationSummary', expected: 'native.preparation.mismatchedPairs' },
  { change: 'preparationCount', expected: 'native.preparation.recordCount' },
  { change: 'preparationInterval', expected: 'native.preparation.interval' },
])('native shard reader retains rejection for $change', async ({ change, expected }) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-shard-rejection-'))
  try {
    const fixture = await writeNativeShardFixture(directory, [0, 1])
    const entry = fixture.index.shards[1]
    const filename = path.join(directory, entry.report.path)
    const report = JSON.parse(await readFile(filename, 'utf8'))
    const quietFile = path.join(path.dirname(filename), entry.artifacts.quietHost ?? '')
    const quiet = JSON.parse(await readFile(quietFile, 'utf8'))
    if (change === 'missingPlanArgument')
      quiet.nativeInvocation.argv = quiet.nativeInvocation.argv.filter(
        (_: string, index: number, argv: string[]) =>
          argv[index] !== '--capture-plan' && argv[index - 1] !== '--capture-plan',
      )
    if (change === 'duplicatePlanArgument')
      quiet.nativeInvocation.argv = quiet.nativeInvocation.argv.concat(['--capture-plan', 'other'])
    if (change === 'absoluteReportPath') quiet.nativeInvocation.reportPath = filename
    if (change === 'otherReportPath')
      quiet.nativeInvocation.reportPath = 'native-other/paired-native.json'
    if (change === 'duplicateLaunch') report.shard.launchId = 'native-launch-0'
    if (change === 'runtime') report.metadata.runtime = 'bun changed-runtime'
    if (change === 'source') report.metadata.sourceFiles[0].sha256 = hash('changed source')
    if (change === 'preparationSummary') report.metadata.launchPreparation.mismatchedPairs = 1
    if (change === 'preparationInterval')
      report.metadata.launchPreparation.startedAt = report.metadata.startedAt
    const prepFile = path.join(path.dirname(filename), 'raw-native-preparation.jsonl')
    const preparation = (await readFile(prepFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    if (change === 'preparationOutput')
      preparation[0].pair.candidate.revisions[0].outputDigest = hash('changed output')
    if (change === 'preparationCoordinate')
      preparation[0].pair.candidate.revisions[0].sourceCoordinateFailures = ['retained raw failure']
    if (change === 'preparationIdentity') preparation[0].pair.candidate.engine = 'remark'
    if (change === 'preparationCount') preparation.pop()
    const contents = preparation.map((row) => JSON.stringify(row)).join('\n') + '\n'
    await writeFile(prepFile, contents)
    report.metadata.launchPreparation.artifact = {
      path: 'raw-native-preparation.jsonl',
      sha256: hash(contents),
      byteLength: Buffer.byteLength(contents),
      recordCount: preparation.length,
    }
    const bytes = JSON.stringify(report)
    await writeFile(filename, bytes)
    entry.report.sha256 = hash(bytes)
    quiet.reportSha256 = hash(bytes)
    await writeFile(quietFile, JSON.stringify(quiet))
    if (change === 'copiedQuiet')
      await writeFile(quietFile, await readFile(path.join(directory, 'native-0/quiet-host.json')))
    if (change === 'missingWarmup') fixture.index.shards.splice(0, 1)
    await fixture.writeIndex()
    const result = await fixture.read()
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.findings.some((finding) => finding.path.includes(expected))).toBe(true)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('native launch finalizer retains original reports and verifies actual native assets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'native-launch-finalizer-'))
  const outside = await mkdtemp(path.join(tmpdir(), 'native-launch-outside-'))
  try {
    await writeNativeShardFixture(directory, [0])
    const launch = path.join(directory, 'native-0')
    const source = path.join(launch, 'snapshot')
    await writeFile(path.join(source, 'bun.lock'), 'lock')
    await mkdir(path.join(source, 'scripts/markdown'), { recursive: true })
    await writeFile(path.join(source, 'scripts/markdown/promotion-budget.json'), 'budget')
    await writeFile(
      path.join(launch, 'host.json'),
      JSON.stringify({ host: 'fixture-host', observedAt: instant(0) }),
    )
    const frozen = path.join(directory, 'frozen.json')
    await writeFile(frozen, JSON.stringify(nativeInput().frozen))
    const filename = path.join(launch, 'paired-native.json')
    const original = await readFile(filename)
    const options = {
      root: directory,
      report: filename,
      source,
      snapshot: 'retained-native-source',
      frozen,
      host: path.join(launch, 'host.json'),
      quietHost: path.join(launch, 'quiet-host.json'),
      grammar: path.join(launch, 'grammar.wasm'),
      chatGrammar: path.join(launch, 'chat-grammar.wasm'),
      resolver: path.join(launch, 'resolver.wasm'),
      output: 'native-sidecars',
    }
    await symlink(outside, path.join(directory, 'escaped-source'))
    await expect(finalizeNativeLaunch({ ...options, snapshot: 'escaped-source' })).rejects.toThrow(
      'inside their evidence root',
    )
    expect(await readdir(outside)).toEqual([])
    await mkdir(path.join(directory, 'nested-source'))
    await symlink(outside, path.join(directory, 'nested-source/scripts'))
    await expect(finalizeNativeLaunch({ ...options, snapshot: 'nested-source' })).rejects.toThrow(
      'inside their evidence root',
    )
    expect(await readdir(outside)).toEqual([])
    const finalized = await finalizeNativeLaunch(options)
    const manifest = JSON.parse(await readFile(finalized.manifestFile, 'utf8'))
    expect(manifest.kind).toBe('native')
    expect(manifest.report).toBe('../native-0/paired-native.json')
    expect(manifest.artifacts.trials).toBe('../native-0/raw-native-pairs.jsonl')
    expect(manifest.artifacts.browser).toBeNull()
    expect(await readFile(filename)).toEqual(original)
    const captured = JSON.parse(
      await readFile(path.join(directory, 'native-sidecars/source-capture.json'), 'utf8'),
    )
    expect(captured.reportSha256).toBe(hash(original.toString()))
    expect(
      await readFile(
        path.join(directory, 'retained-native-source/native-assets/chatGrammar.wasm'),
        'utf8',
      ),
    ).toBe('chat grammar')
    await writeFile(options.grammar, 'changed grammar')
    await expect(
      finalizeNativeLaunch({ ...options, output: 'changed-native-sidecars' }),
    ).rejects.toThrow('native asset differs')
  } finally {
    await rm(directory, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

function independentResourceRows(duration: number) {
  return [
    {
      name: 'https://fixture.invalid/worker.js',
      kind: 'javascript' as const,
      initiatorType: 'other',
      startTime: 1,
      duration,
      transferSize: 10,
      decodedBodySize: 20,
    },
  ]
}
function withNegativeResources(
  row: InlineProductionTrial,
  where: 'measured' | 'oracle' | 'both',
): InlineProductionTrial {
  return {
    ...row,
    receipt: {
      ...row.receipt,
      resources: independentResourceRows(
        where === 'oracle' ? 2.5999999046325684 : -21.200000047683716,
      ),
    },
    correctness: {
      ...row.correctness,
      resources: independentResourceRows(
        where === 'measured' ? 2.6999998092651367 : -9.599999904632568,
      ),
    },
  }
}
test.each(['measured', 'oracle', 'both'] as const)(
  'independent checks accept complete synthetic evidence with unusable %s durations',
  async (where) => {
    const result = await reconcileTimingEvidence(
      productionInput((report) => {
        report.rawTrials = report.rawTrials.map((row) => withNegativeResources(row, where))
        report.warmupResults = report.warmupResults.map((row) => withNegativeResources(row, where))
      }),
    )
    expect(result.findings).toEqual([])
    expect(result.exclusions).toEqual([])
    expect(result.verdict).toBe('VERIFIED')
    expect(result.samples).toHaveLength(46)
    expect(result.comparisons).toHaveLength(4)
    expect(result.comparisons.every((row) => row.independentTrials === 20)).toBe(true)
  },
)

test('unusable durations cannot fill missing real CPU or shrink the required denominator', async () => {
  const result = await reconcileTimingEvidence(
    productionInput((report) => {
      report.rawTrials = report.rawTrials.map((row) => withNegativeResources(row, 'both'))
      const row = report.rawTrials[0]
      report.rawTrials[0] = { ...row, streamMainThreadCpuMs: null }
      report.comparisons = fixtureProductionComparisons(row.workload).map((entry) =>
        entry.metric === 'streamCpu'
          ? {
              ...pairedConfidence({
                workload: row.workload,
                metric: 'streamCpu',
                seed: 941,
                resamples: 4096,
                baseline: Array<number>(19).fill(5),
                candidate: Array<number>(19).fill(5),
              }),
              domain: 'browser',
              build: 'production',
              excludedPairs: [
                { pair: row.pair, engine: row.engine, reason: 'Missing main-thread CPU' },
              ],
            }
          : entry,
      )
    }),
  )
  expect(result.verdict).toBe('INCONCLUSIVE')
  expect(result.findings.length).toBeGreaterThan(0)
  expect(result.findings.every((entry) => entry.kind === 'missing')).toBe(true)
  expect(
    result.samples.find((row) => row.pair === 0 && row.engine === 'remark')?.streamCpu,
  ).toBeNull()
  expect(result.comparisons.find((row) => row.metric === 'streamCpu')?.independentTrials).toBe(19)
  expect(
    result.findings.some((entry) => entry.reason.includes('20 complete independent paired')),
  ).toBe(true)
})

const missingIndependentEvidence = [
  {
    name: 'frame clock',
    change: (row: InlineProductionTrial) => {
      Reflect.deleteProperty(row.receipt.frames[0], 'painted')
    },
  },
  {
    name: 'held release',
    change: (row: InlineProductionTrial) => {
      Reflect.set(row.receipt, 'heldSyntax', null)
    },
  },
  {
    name: 'per-update CPU',
    change: (row: InlineProductionTrial) => {
      Reflect.set(row, 'updateCpu', [])
    },
  },
  {
    name: 'worker coverage',
    change: (row: InlineProductionTrial) => {
      Reflect.set(row, 'workerCpu', null)
    },
  },
  {
    name: 'worker identity',
    change: (row: InlineProductionTrial) => {
      Reflect.set(row, 'workers', null)
    },
  },
  {
    name: 'long tasks',
    change: (row: InlineProductionTrial) => {
      Reflect.set(row.receipt, 'longTasks', null)
    },
  },
  {
    name: 'network',
    change: (row: InlineProductionTrial) => {
      Reflect.set(row, 'network', null)
    },
  },
  {
    name: 'input identity',
    change: (row: InlineProductionTrial) => {
      Reflect.deleteProperty(row.receipt.final, 'inputSha256')
    },
  },
  {
    name: 'measured resources',
    change: (row: InlineProductionTrial) => {
      Reflect.deleteProperty(row.receipt, 'resources')
    },
  },
]
test.each(missingIndependentEvidence)(
  'unusable durations cannot fill missing $name',
  async ({ change }) => {
    const result = await reconcileTimingEvidence(
      productionInput((report) => {
        const row = withNegativeResources(report.rawTrials[0], 'both')
        change(row)
        report.rawTrials[0] = row
      }),
    )
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.timingStatus).toBe('PROMOTION_CAPTURE_UNRECONCILED')
    expect(result.findings.length).toBeGreaterThan(0)
  },
)

type MeasuredResourceTampering = 'sign' | 'identity' | 'order' | 'duplicate'
function tamperedMeasuredResources(row: ProductionTrial, change: MeasuredResourceTampering) {
  const resources = row.receipt.resources.map((resource) => ({ ...resource }))
  if (change === 'sign') resources[0].duration = -resources[0].duration
  if (change === 'identity') resources[0].name = 'changed'
  if (change === 'order') resources.reverse()
  if (change === 'duplicate') resources.push({ ...resources[0] })
  return { ...row, receipt: { ...row.receipt, resources } }
}
async function measuredResourceTamperResult(change: MeasuredResourceTampering) {
  const directory = await mkdtemp(path.join(tmpdir(), 'markdown-resource-tamper-'))
  const input = productionInput((report) => {
    const row = report.rawTrials[0]
    report.rawTrials[0] = {
      ...row,
      receipt: {
        ...row.receipt,
        resources: independentResourceRows(-21.200000047683716).concat(
          independentResourceRows(2.5999999046325684),
        ),
      },
    }
  })
  try {
    const files = await writeFixture(directory, input)
    const options = {
      root: directory,
      kind: input.kind,
      report: input.report.path,
      frozen: input.frozen,
      artifacts: files,
    }
    expect((await reconcileFiles(options)).verdict).toBe('VERIFIED')
    const rawPath = path.join(directory, files.trials)
    const lines = (await readFile(rawPath, 'utf8')).trimEnd().split('\n')
    changedProductionLine(lines, 6, (row) => tamperedMeasuredResources(row, change))
    await writeFile(rawPath, lines.join('\n') + '\n')
    return await reconcileFiles(options)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
test.each(['sign', 'identity', 'order', 'duplicate'] as const)(
  'fixed whole-trials reference rejects measured resource %s tampering',
  async (change) => {
    const result = await measuredResourceTamperResult(change)
    expect(result.verdict).not.toBe('VERIFIED')
    expect(result.findings.some((entry) => entry.reason.includes('digest differs'))).toBe(true)
  },
)
