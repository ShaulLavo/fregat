import { MARKDOWN_CASES } from '../../packages/markdown/test/fixtures/cases'
import { createHash, hash } from 'node:crypto'
import { mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ProductionTrial } from './production-analysis'
import type { productionBrowserControls } from './production-controls'
import { writeProductionOracle, type ProductionOracleRecord } from './production-oracle'
import type { ProductionMarkdownFrame } from '../../apps/web/test/factories/markdown-production-types'
import {
  nativePairWorkloads,
  pairedTrialOrders,
  writeNativePairs,
  type NativePairWorkload,
  type NativeTrial,
  type NativeRevision,
} from './paired-native'
import { productionTrialRecords, writeProductionTrials } from './production-browser'
import { foldJsonl, hashFile, type RawTimingRef } from './timing-artifacts'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  productionBrowserWorkloads,
  productionUpdates,
  productionTimingManifest,
  type ProductionWorkload,
} from './production-workloads'
import { stable } from './serialization'
import { fixedChunks } from './workloads'
import type { PromotionEvidenceAssemblyResult } from './promotion-evidence'
import type { PromotionEvidence } from './promotion'
import type { qualificationProvenance } from './provenance'

type Source = Awaited<ReturnType<typeof qualificationProvenance>>
type Resources = {
  rawTrials: readonly {
    workload: string
    engine: string
    resourceWindows: ProductionTrial['resourceWindows']
    resourceControlWindows: ProductionTrial['resourceControlWindows']
  }[]
}
const instant = (seconds: number) => new Date(Date.UTC(2026, 9, 18, 12, 0, seconds)).toISOString()
const fontEnvironment = {
  fontFamily: 'Fixture Sans',
  fonts: [{ family: 'Fixture Sans', status: 'loaded', weight: '400' }],
}
const fontFiles = [{ path: 'assets/fixture.woff2', sha256: hash('sha256', 'fixture font bytes') }]
const fontFingerprint = hash('sha256', stable({ files: fontFiles, ...fontEnvironment }))
const hostIdentity = {
  host: 'fixture-host',
  platform: 'darwin',
  architecture: 'arm64',
  hardware: 'fixture CPU',
  osRelease: 'fixture OS',
  memoryBytes: 1000,
}

async function save(directory: string, file: string, value: unknown) {
  await writeFile(path.join(directory, file), JSON.stringify(value))
}
async function fileHash(file: string) {
  const digest = createHash('sha256')
  const handle = await open(file)
  try {
    for await (const bytes of handle.createReadStream()) digest.update(bytes)
  } finally {
    await handle.close()
  }
  return digest.digest('hex')
}
function quietHost(reportPath: string, reportSha256: string) {
  return {
    ...hostIdentity,
    reportSha256,
    nativeInvocation: {
      executablePath: '/fixture/bun',
      argv: ['/fixture/bun', 'scripts/markdown/paired-native.ts', '--mode', 'qualification'],
      runtime: 'bun 1.3.fixture',
      reportPath,
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
  }
}
function projection(input: string) {
  const content = { text: 'synthetic', elements: [] }
  const output = {
    digest: hash('sha256', JSON.stringify(content)),
    textBytes: Buffer.byteLength(content.text),
    elementCount: 0,
  }
  return { inputSha256: hash('sha256', input), paintedOutput: output, ...content }
}
export function syntheticProductionControls(): Awaited<
  ReturnType<typeof productionBrowserControls>
> {
  const digest = hash('sha256', 'synthetic control output')
  return {
    knownGood: { expected: digest, observed: digest, revision: 2, observedRevision: 2 },
    missingExpectation: { rejected: true, reason: 'Synthetic missing expectation rejected' },
    wrongExpectation: { rejected: true, reason: 'Synthetic wrong output rejected' },
    longTask: { supported: true, observed: [80] },
  }
}
type ProductionTemplate = Omit<ProductionTrial, 'correctness' | 'freshCompleted'>
export function syntheticProductionTemplate(
  workload: ProductionWorkload,
  pair: number,
  engine: ProductionTrial['engine'],
): ProductionTemplate {
  const inputs = productionUpdates(workload).concat([workload.source])
  const frames = inputs.map((input, index) => ({
    revision: index + 1,
    inputSha256: hash('sha256', input),
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
      frames: frames.filter(
        (_, index) =>
          workload.arrival === 'paced' || (index + 1) % 32 === 0 || index >= frames.length - 2,
      ),
      final,
      fullyReady: final.painted + 1,
      fullyReadyOutput: final.paintedOutput,
      skippedPaintRevisions: frames
        .filter(
          (_, index) =>
            workload.arrival !== 'paced' && (index + 1) % 32 !== 0 && index < frames.length - 2,
        )
        .map((tick) => tick.revision),
      heldSyntax: { held, released, holdMs: 0 },
      longTasks: [],
      resources: [],
    },
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
function oracleFrame(
  frame: ProductionTemplate['receipt']['processed'][number],
): ProductionMarkdownFrame {
  return {
    ...frame,
    observedRevision: frame.revision,
    painted: frame.committed + 1,
    paintedOutput: frame.output,
    text: 'synthetic',
    elements: [],
  }
}
async function* syntheticOracleRecords(
  row: ProductionTemplate,
): AsyncGenerator<ProductionOracleRecord> {
  for (const frame of row.receipt.processed) yield { kind: 'frame', frame: oracleFrame(frame) }
  const final = oracleFrame(row.receipt.final)
  yield {
    kind: 'final',
    frame: final,
    fullyReady: row.receipt.fullyReady,
    longTasks: row.receipt.longTasks,
    resources: row.receipt.resources,
  }
  yield { kind: 'fresh', frame: final }
}
export async function writeSyntheticProductionArm(
  directory: string,
  row: ProductionTemplate,
): Promise<ProductionTrial> {
  await mkdir(path.join(directory, 'oracles'), { recursive: true })
  const captured = await writeProductionOracle({
    root: directory,
    file: `oracles/${row.workload}-${row.pair}-${row.engine}.jsonl`,
    records: syntheticOracleRecords(row),
  })
  return { ...row, ...captured }
}
export function syntheticNativeTrial(
  workload: NativePairWorkload,
  trial: number,
  engine: 'remark' | 'tree-sitter',
): NativeTrial {
  const timing = trial < 0 ? 11 : 1
  const updates =
    workload.revisions ??
    (workload.scheduleUnits > 0
      ? Array.from(fixedChunks(workload.source, workload.scheduleUnits), (frame) => frame.text)
      : [workload.source])
  const revisions: NativeRevision[] = updates.map((source, revision) => ({
    revision,
    offset: source.length,
    phase: 'update',
    parseMs: timing,
    projectionMs: 0,
    convertedBlocks: 1,
    reusedBlocks: 0,
    sourceCoordinatesDigest: hash('sha256', source),
    positionedNodes: 1,
    unchangedProjection: false,
    wallMs: timing,
    cpuMs: timing,
    outputDigest: hash('sha256', source),
    sourceCoordinateFailures: [],
  }))
  return {
    engine,
    trial,
    mountMs: timing,
    streamCpuMs: timing * 2,
    revisions: revisions.concat([
      {
        revision: updates.length,
        offset: workload.source.length,
        phase: 'settlement',
        parseMs: timing,
        projectionMs: 0,
        convertedBlocks: 1,
        reusedBlocks: 0,
        sourceCoordinatesDigest: hash('sha256', workload.source),
        positionedNodes: 1,
        unchangedProjection: false,
        wallMs: timing,
        cpuMs: timing,
        outputDigest: hash('sha256', workload.source),
        sourceCoordinateFailures: [],
      },
    ]),
  }
}

async function writeNative(
  directory: string,
  identity: PromotionEvidence['identity'],
  source: Source,
) {
  const sourceFiles = source.sources
    .filter((row) => row.file === 'scripts/markdown/workloads.ts')
    .map((row) => ({ path: row.file, sha256: row.sha256 }))
  const metadata = {
    ...identity,
    startedAt: instant(1),
    finishedAt: instant(9),
    seed: 176,
    trials: 20,
    warmups: 3,
    timingStatus: 'EXPLORATORY',
    ...hostIdentity,
    runtime: 'bun 1.3.fixture',
    sourceFiles,
    candidateSourceSha256: hash('sha256', JSON.stringify(sourceFiles)),
    revision: source.revision,
  }
  const observed = await writeNativePairs({
    output: directory,
    workloads: nativePairWorkloads('qualification'),
    orders: pairedTrialOrders(20, metadata.seed),
    warmups: 3,
    seed: metadata.seed,
    mode: 'qualification',
    capture: ({ workload, trial, engine }) => syntheticNativeTrial(workload, trial, engine),
  })
  const file = path.join(directory, 'paired-native.json')
  await save(directory, 'paired-native.json', {
    schemaVersion: 2,
    verdict: 'NOT VERIFIED',
    scope: 'paired-native-source',
    status: 'passed',
    mode: 'qualification',
    metadata,
    ...observed,
    missing: [],
    resources: { created: [], cleanup: [], retained: ['Sealed raw pairs and scalar summaries'] },
  })
  await recordStatistics(directory, observed.pairsArtifact)
  const reportSha256 = await fileHash(file)
  await save(directory, 'native-quiet.json', quietHost(file, reportSha256))
  await save(directory, 'native-source-capture.json', {
    reportSha256,
    sourceRoot: 'source',
    provenance: source,
    files: {
      lockfile: 'files/bun.lock',
      grammar: 'assets/tree-sitter-markdown.wasm',
      chatGrammar: 'assets/tree-sitter-markdown-chat.wasm',
      resolver: 'assets/tree-sitter-md.wasm',
      budget: 'files/promotion-budget.json',
    },
  })
  await save(directory, 'native-input.json', {
    schemaVersion: 1,
    kind: 'native',
    report: 'paired-native.json',
    frozen: 'freeze.json',
    artifacts: {
      host: null,
      quietHost: 'native-quiet.json',
      build: null,
      buildManifest: null,
      browser: null,
      fonts: null,
      trials: 'raw-native-pairs.jsonl',
      sourceCapture: 'native-source-capture.json',
    },
  })
}
function resourceTrial(row: ProductionTrial, resources: Resources): ProductionTrial {
  const resource = resources.rawTrials.find(
    (entry) => row.workload === `resources-${entry.workload}` && entry.engine === row.engine,
  )
  if (!resource) return row
  return {
    ...row,
    resourceWindows: resource.resourceWindows,
    resourceControlWindows: resource.resourceControlWindows,
  }
}
async function writeProduction(
  directory: string,
  identity: PromotionEvidence['identity'],
  source: Source,
  resources: Resources,
) {
  const provenance = {
    revision: source.revision,
    trackedDiffSha256: source.trackedDiffSha256,
    lockfileSha256: source.lockfileSha256,
    sourceClosureSha256: source.sourceClosureSha256,
  }
  const host = { ...hostIdentity, observedAt: instant(0) }
  await save(directory, 'host.json', host)
  const buildManifest = { 'index.html': { file: 'assets/main.js' } }
  await save(directory, 'build-manifest.json', buildManifest)
  const artifacts = await Promise.all(
    [
      'tree-sitter-markdown.wasm',
      'tree-sitter-markdown-chat.wasm',
      'tree-sitter-md.wasm',
      'fixture.woff2',
    ].map(async (file) => {
      const bytes = await readFile(path.join(directory, 'assets', file))
      return { file, sha256: hash('sha256', bytes), bytes: bytes.length }
    }),
  )
  const build = {
    schemaVersion: 1,
    sourceBefore: provenance,
    sourceAfter: provenance,
    artifactManifestSha256: hash('sha256', JSON.stringify(buildManifest)),
    budgetSha256: identity.budgetSha256,
    artifacts,
  }
  await save(directory, 'markdown-probe-build.json', build)
  const browser = {
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
  }
  await save(directory, 'browser.json', {
    host: host.host,
    executablePath: browser.executablePath,
    version: browser.version,
    args: browser.actualArgs,
  })
  await save(directory, 'fonts.json', {
    host: host.host,
    fingerprint: fontFingerprint,
    files: fontFiles,
    ...fontEnvironment,
  })
  const workloads = productionBrowserWorkloads()
  let current: ProductionWorkload | undefined
  let template: ProductionTemplate
  const failures: string[] = []
  const observed = await writeProductionTrials({
    output: directory,
    workloads,
    available: workloads,
    records: productionTrialRecords({
      workloads,
      trials: 20,
      warmups: 3,
      failures,
      capture: async ({ workload, pair, order, engine }) => {
        if (current !== workload) {
          current = workload
          template = syntheticProductionTemplate(workload, 0, 'remark')
        }
        const captured = await writeSyntheticProductionArm(directory, {
          ...template,
          pair,
          order,
          engine,
        })
        return resourceTrial(captured, resources)
      },
    }),
  })
  await recordStatistics(directory, observed.trialsArtifact)
  const report = {
    schemaVersion: 2,
    build: 'production',
    timingStatus: 'PROMOTION_CAPTURE_UNRECONCILED',
    controls: syntheticProductionControls(),
    capture: {
      kind: 'promotion',
      hostEvidence: { sha256: hash('sha256', JSON.stringify(host)), observation: host },
    },
    host: {
      id: host.host,
      ...hostIdentity,
      before: { observedAt: instant(1), loadAverage: [0, 0, 0], logicalCpus: 8 },
      after: { observedAt: instant(9), loadAverage: [0, 0, 0], logicalCpus: 8 },
    },
    browser,
    provenance: source,
    servedBuild: {
      revision: source.revision,
      sourceClosureSha256: source.sourceClosureSha256,
      budgetSha256: identity.budgetSha256,
      artifactManifestSha256: build.artifactManifestSha256,
      artifactCount: artifacts.length,
    },
    frozenBudgetSha256: identity.budgetSha256,
    workloadManifest: productionTimingManifest(),
    selectedWorkloads: productionBrowserWorkloads().map(({ source, ...entry }) => ({
      ...entry,
      sourceSha256: hash('sha256', source),
    })),
    trials: 20,
    warmups: 3,
    failures: failures.concat(observed.ordinaryFindings, observed.incompleteEvidence),
    trialsArtifact: observed.trialsArtifact,
    sampleSummaries: observed.sampleSummaries,
    comparisons: observed.comparisons,
    familyCoverage: observed.familyCoverage,
    resourcePlateaus: observed.resourcePlateaus,
  }
  const file = path.join(directory, 'production-browser.json')
  await save(directory, 'production-browser.json', report)
  await save(directory, 'production-quiet.json', quietHost(file, await fileHash(file)))
  await save(directory, 'production-input.json', {
    schemaVersion: 1,
    kind: 'production',
    report: 'production-browser.json',
    frozen: 'freeze.json',
    artifacts: {
      host: 'host.json',
      quietHost: 'production-quiet.json',
      build: 'markdown-probe-build.json',
      buildManifest: 'build-manifest.json',
      browser: 'browser.json',
      fonts: 'fonts.json',
      trials: 'raw-production-trials.jsonl',
      sourceCapture: null,
    },
  })
}
export async function writeFullSyntheticTiming(options: {
  directory: string
  sourceRoot: string
  identity: PromotionEvidence['identity']
  provenance: Source
  resources: Resources
}) {
  const { directory, identity, provenance, sourceRoot, resources } = options
  const frozenProvenance = {
    revision: provenance.revision,
    trackedDiffSha256: provenance.trackedDiffSha256,
    lockfileSha256: provenance.lockfileSha256,
    sourceClosureSha256: provenance.sourceClosureSha256,
  }
  await mkdir(path.join(directory, 'assets'), { recursive: true })
  await mkdir(path.join(directory, 'files'), { recursive: true })
  for (const [name, bytes] of [
    ['tree-sitter-markdown.wasm', 'grammar'],
    ['tree-sitter-markdown-chat.wasm', 'chat-grammar'],
    ['tree-sitter-md.wasm', 'resolver'],
    ['fixture.woff2', 'fixture font bytes'],
  ])
    await writeFile(path.join(directory, 'assets', name), bytes)
  await writeFile(
    path.join(directory, 'files/bun.lock'),
    await readFile(path.join(sourceRoot, 'bun.lock')),
  )
  await writeFile(
    path.join(directory, 'files/promotion-budget.json'),
    await readFile(new URL('./promotion-budget.json', import.meta.url)),
  )
  for (const row of provenance.sources) {
    const file = path.join(directory, 'source', row.file)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, await readFile(path.join(sourceRoot, row.file)))
  }
  await save(directory, 'freeze.json', { identity, provenance: frozenProvenance, fontFingerprint })
  await writeNative(directory, identity, provenance)
  await writeProduction(directory, identity, provenance, resources)
  return { fontFingerprint }
}

async function recordStatistics(root: string, reference: RawTimingRef) {
  let largestRecord = 0
  let pendingRecords = 0
  let maximumPendingRecords = 0
  let byteOffset = 0
  let lastWarmup: { offset: number; bytes: number } | null = null
  let firstResource: { offset: number; bytes: number } | null = null
  let lastRecord = { offset: 0, bytes: 0 }
  await foldJsonl({
    root,
    file: reference.path,
    expected: reference,
    parse: (value) => value,
    consume: async (value) => {
      pendingRecords++
      maximumPendingRecords = Math.max(maximumPendingRecords, pendingRecords)
      const bytes = Buffer.byteLength(JSON.stringify(value)) + 1
      largestRecord = Math.max(largestRecord, bytes)
      if (
        typeof value === 'object' &&
        value !== null &&
        'pair' in value &&
        typeof value.pair === 'number' &&
        value.pair < 0
      )
        lastWarmup = { offset: byteOffset, bytes }
      if (
        typeof value === 'object' &&
        value !== null &&
        'family' in value &&
        value.family === 'resources' &&
        'pair' in value &&
        typeof value.pair === 'number' &&
        value.pair >= 0
      )
        firstResource ??= { offset: byteOffset, bytes }
      lastRecord = { offset: byteOffset, bytes }
      byteOffset += bytes
      await Promise.resolve()
      pendingRecords--
    },
  })
  const statistics = {
    ...reference,
    largestRecord,
    lastWarmup,
    firstResource,
    lastRecord,
    maximumPendingRecords,
  }
  await save(root, `${reference.path}.statistics.json`, statistics)
  return statistics
}

export async function fullAssemblySummary(manifestPath: string) {
  const directory = path.dirname(manifestPath)
  const evidencePath = path.join(directory, 'assembled-evidence.json')
  const reportPath = path.join(directory, 'assembled-report.json')
  await Promise.all(
    [
      evidencePath,
      reportPath,
      path.join(directory, 'assembled-native-timing-reconciliation.json'),
      path.join(directory, 'assembled-production-timing-reconciliation.json'),
    ].map((file) => rm(file, { force: true })),
  )
  const cli = spawnSync(
    'bun',
    [
      fileURLToPath(new URL('./promotion-evidence.ts', import.meta.url)),
      '--manifest',
      manifestPath,
      '--out',
      evidencePath,
      '--report',
      reportPath,
    ],
    { encoding: 'utf8', timeout: 360_000, maxBuffer: 2 * 1024 * 1024 },
  )
  const { parsePromotionEvidenceAssemblyManifest } = await import('./promotion-evidence')
  const {
    verifyPromotionArtifacts,
    evaluatePromotion,
    createTrustedPromotionContext,
    frozenBudgetSha256,
  } = await import('./promotion')
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    JSON.parse(await readFile(manifestPath, 'utf8')),
  )
  const evidence: PromotionEvidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  const report: PromotionEvidenceAssemblyResult['report'] = JSON.parse(
    await readFile(reportPath, 'utf8'),
  )
  const verified = await verifyPromotionArtifacts(evidence, directory)
  const context = manifest.trustedContext
    ? await createTrustedPromotionContext({
        ...manifest.trustedContext,
        evidenceDirectory: directory,
      })
    : undefined
  const validation = evaluatePromotion(evidence, await frozenBudgetSha256(), verified, context)
  const timing = report.timing.map((entry) => ({
    kind: entry.kind,
    verdict: entry.verdict,
    findings: entry.findings,
    measured: entry.samples.filter((sample) => !sample.warmup).length,
    warmup: entry.samples.filter((sample) => sample.warmup).length,
    comparisons: entry.comparisons.length,
    metrics: entry.metrics,
  }))
  const files = ['assembled-evidence.json', 'assembled-report.json'].concat(
    report.timing.flatMap((entry) => [
      entry.kind === 'native' ? 'paired-native.json' : 'production-browser.json',
      `assembled-${entry.kind}-timing-reconciliation.json`,
    ]),
  )
  return {
    ...validation,
    observations: report.gates,
    verdict: report.verdict,
    findings: report.findings,
    exit: cli.status,
    signal: cli.signal,
    error: cli.error?.message ?? null,
    stderr: cli.stderr,
    finalArtifactVerdict: validation.verdict,
    nativeWorkloads: evidence.nativeWorkloads.length,
    expectedWorkloads: evidence.expectedWorkloads.length,
    receipts: evidence.receipts.map((entry: { gate: string; counts: unknown }) => ({
      gate: entry.gate,
      counts: entry.counts,
    })),
    timing,
    artifacts: report.artifacts.length,
    files: await Promise.all(files.map((file) => hashFile({ root: directory, file }))),
  }
}

export async function syntheticNativeResources(
  directory: string,
  provenance: Pick<
    Source,
    'revision' | 'trackedDiffSha256' | 'lockfileSha256' | 'sourceClosureSha256' | 'sources'
  >,
) {
  const assets: { asset: string; file: string; sha256: string; bytes: number }[] = []
  for (const [asset, file] of [
    ['tree-sitter-markdown.wasm', 'grammar.wasm'],
    ['tree-sitter-markdown-chat.wasm', 'chat-grammar.wasm'],
    ['tree-sitter-md.wasm', 'resolver.wasm'],
  ] as const) {
    const bytes = await readFile(path.join(directory, file))
    assets.push({ asset, file, sha256: hash('sha256', bytes), bytes: bytes.length })
  }
  const rawWindows = [20, 100, 500].flatMap((cycles) =>
    (['remark', 'tree-sitter'] as const).flatMap((engine) =>
      Array.from({ length: 4 }, (_, window) => ({
        engine,
        cycles,
        window,
        before: {
          heapUsedBytes: 1000,
          rssBytes: 2000,
          wasmReservedBytes: 65536,
          gcPerformed: true,
        },
        after: { heapUsedBytes: 1000, rssBytes: 2000, wasmReservedBytes: 65536, gcPerformed: true },
        outputFailures: Array<string>(),
        cleanupFailures: Array<string>(),
        clearedSessions: cycles,
        clearedProjectionEntries: cycles,
      })),
    ),
  )
  const summaries = [20, 100, 500].flatMap((cycles) =>
    ['remark', 'tree-sitter'].map((engine) => ({
      engine,
      cycles,
      windows: 4,
      status: 'OBSERVED_PLATEAU',
      gcStatus: 'POST_GC',
      heapAfterReleaseBytes: [1000, 1000, 1000, 1000],
      rssAfterReleaseBytes: [2000, 2000, 2000, 2000],
      wasmReservedBytes: [65536, 65536, 65536, 65536],
      heapWindowDeltasBytes: [0, 0, 0],
      rssWindowDeltasBytes: [0, 0, 0],
      wasmWindowDeltasBytes: [0, 0, 0],
      heapObservedRangeBytes: 0,
      wasmHighWaterReuseObserved: true,
    })),
  )
  const report = {
    schemaVersion: 1,
    verdict: 'NOT VERIFIED',
    nativeStatus: 'OBSERVED_PLATEAU',
    browser: { status: 'NOT_MEASURED' },
    provenance,
    candidate: { assets },
    sources: MARKDOWN_CASES.map(({ id, source }) => ({
      id,
      sha256: hash('sha256', source),
      sourceBytes: Buffer.byteLength(source),
    })),
    rawWindows,
    summaries,
    failures: Array<string>(),
    exclusions: Array<string>(),
  }
  await save(directory, 'native-resources.json', report)
  await writeFile(
    path.join(directory, 'native-resources.jsonl'),
    rawWindows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  )
  return report
}
