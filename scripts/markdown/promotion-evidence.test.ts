import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mkdtemp, mkdir, open, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, test } from 'vitest'
import { PNG } from 'pngjs'
import { compareRasterEvidence } from './paired-raster'
import { captureQualificationArtifacts, qualificationSourceContext, type TestRun } from './qualify'
import {
  FROZEN_SCENARIOS,
  PROMOTION_GATES,
  frozenBudgetSha256,
  createTrustedPromotionContext,
} from './promotion'
import {
  fullAssemblySummary,
  syntheticNativeResources,
  writeFullSyntheticTiming,
  syntheticProductionTemplate,
  syntheticProductionControls,
  syntheticNativeTrial,
  writeSyntheticProductionArm,
} from './promotion-evidence-full-assembly-fixture'
import {
  productionBrowserWorkloads,
  productionTimingManifest,
  productionUpdates,
} from './production-workloads'
import { reconcileProductionOracles } from './production-oracle'
import { hashFile } from './timing-artifacts'
import type { NativeWorkloadSummary } from './paired-native'
import { createScriptError } from '../structured-errors'
import { EXCLUSION_GROUPS, sourceIdentity } from './evaluation-custody'
import { encoded } from './serialization'
import {
  browserInput,
  evaluationCounts,
  type CandidateIdentity,
  type EvaluationCase,
  type EvaluationMessage,
} from './evaluate-heldout'
import { collectBrowserEvaluation } from './evaluate-heldout-browser'
import {
  MARKDOWN_CASES,
  VISUAL_STORY_IDS,
  WEBKIT_CRITICAL_IDS,
} from '../../packages/markdown/test/fixtures/cases'
import {
  assemblePromotionEvidence,
  parsePromotionEvidenceAssemblyManifest,
  type PromotionEvidenceAssemblyManifest,
} from './promotion-evidence'

const temporary = new Set<string>()
const sha = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const identity = (budgetSha256: string) => ({
  candidateCommit: 'a'.repeat(40),
  grammarSha256: sha('grammar'),
  chatGrammarSha256: sha('chat-grammar'),
  resolverSha256: sha('resolver'),
  candidateSourceSha256: sha('candidate'),
  lockfileSha256: sha('lockfile'),
  budgetSha256,
  evaluationManifestSha256: sha('evaluation-manifest'),
  workloadManifestSha256: sha('workload-manifest'),
})
const sourceRows = [{ file: 'synthetic.ts', sha256: sha('synthetic source') }]
const provenance = {
  revision: 'a'.repeat(40),
  trackedDiffSha256: sha(''),
  lockfileSha256: sha('lockfile'),
  sourceClosureSha256: sha(JSON.stringify(sourceRows)),
  sources: sourceRows,
}
const frozenProvenance = {
  revision: provenance.revision,
  trackedDiffSha256: provenance.trackedDiffSha256,
  lockfileSha256: provenance.lockfileSha256,
  sourceClosureSha256: provenance.sourceClosureSha256,
}
const nativeWorkloads = Array.from({ length: 75 }, (_, index) => ({
  id: `native-${index}`,
  sourceBytes: 128,
  scheduleUnits: 24,
  metrics: ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const,
}))
const expectedWorkloads = [
  {
    id: 'ordinary',
    sourceBytes: 128,
    scheduleUnits: 24,
    metrics: ['updateP95', 'settlementP95', 'mountP95', 'streamCpu'] as const,
    arrival: 'paced' as const,
    scheduleId: 'ordinary-v1',
    sourceSha256: sha('ordinary'),
    expectedInputUpdates: 24,
    paintPolicy: 'every-revision' as const,
  },
]

const interactions = FROZEN_SCENARIOS.interactions ?? []
const safety = FROZEN_SCENARIOS.safety ?? []
const frames = FROZEN_SCENARIOS['frame-probes'] ?? []
afterEach(async () => {
  await Promise.all(
    Array.from(temporary, (directory) => rm(directory, { recursive: true, force: true })),
  )
  temporary.clear()
})

async function fixture(existingDirectory?: string) {
  const directory = existingDirectory ?? (await mkdtemp(path.join(tmpdir(), 'promotion-evidence-')))
  if (!existingDirectory) temporary.add(directory)
  await writeFile(path.join(directory, 'grammar.wasm'), 'grammar')
  await writeFile(path.join(directory, 'chat-grammar.wasm'), 'chat-grammar')
  await writeFile(path.join(directory, 'resolver.wasm'), 'resolver')
  const budgetSha256 = await frozenBudgetSha256()
  return {
    directory,
    manifest: (reports: Record<string, string> = {}, extra: Record<string, unknown> = {}) => ({
      schemaVersion: 1 as const,
      evidenceDirectory: directory,
      identity: identity(budgetSha256),
      nativeWorkloads,
      expectedWorkloads,
      frozenProvenance,
      reports,
      artifacts: {
        'candidate-capabilities': ['grammar.wasm', 'chat-grammar.wasm', 'resolver.wasm'],
      },
      ...extra,
    }),
  }
}

function qualification(failed = 0) {
  return {
    schemaVersion: 1,
    provenance,
    checkExecution: { status: 'PASSED', exitCode: 0 },
    candidate: {
      status: 'available-unqualified',
      artifacts: [
        { kind: 'grammar', file: 'grammar.wasm', bytes: 7, sha256: sha('grammar') },
        { kind: 'chatGrammar', file: 'chat-grammar.wasm', bytes: 12, sha256: sha('chat-grammar') },
        { kind: 'resolver', file: 'resolver.wasm', bytes: 8, sha256: sha('resolver') },
      ],
      observedCapabilities: {
        commonmark: true,
        gfm: true,
        math: true,
        footnotes: true,
        cjkFlanking: true,
      },
      semanticChecks: { executed: 8, passed: 8, failed: 0, findings: [] },
    },
    runs: [
      {
        name: 'package-tree-sitter',
        exitCode: 0,
        tests: 1426,
        passed: 1426 - failed,
        failed,
        pending: 0,
        todo: 0,
        log: 'package.log',
      },
      {
        name: 'browser-tree-sitter-qualify',
        exitCode: 0,
        tests: 102,
        passed: 102,
        failed: 0,
        pending: 0,
        todo: 0,
        log: 'browser.log',
      },
    ],
  }
}

function rawAssertions(names: readonly string[]) {
  return {
    testResults: [
      {
        assertionResults: names.map((fullName) => ({
          fullName,
          title: fullName.replace(
            /^(real chat prefix projection|Tree-sitter actual product semantics) /u,
            '',
          ),
          status: 'passed',
        })),
      },
    ],
  }
}

const nativeStreamIds = MARKDOWN_CASES.filter((fixture) => fixture.checkpoints.length > 0).map(
  (fixture) => fixture.id,
)

function streamAssertions(engine: 'remark' | 'tree-sitter') {
  const nativeSuffix =
    engine === 'remark'
      ? ': named live checkpoints match independent product expectations'
      : ' paints all live checkpoints and settles to fresh candidate output'
  const suite = engine === 'tree-sitter' ? 'Tree-sitter actual product semantics ' : ''
  const native = nativeStreamIds.map((id) => `${suite}${id}${nativeSuffix}`)
  const browser = frames.map(
    (id) =>
      `real chat prefix projection ${id} paints every named prefix and settles to the completed result`,
  )
  return native.concat(browser)
}

function frameLog(engine: 'remark' | 'tree-sitter') {
  return frames
    .map((fixture) => {
      const requiredRevisions =
        MARKDOWN_CASES.find((entry) => entry.id === fixture)?.checkpoints.length ?? 0
      const observedRevisions = Array.from({ length: requiredRevisions }, (_, index) => index + 1)
      return `MARKDOWN_BROWSER_FRAMES ${JSON.stringify({ fixture, engine, observedFrames: requiredRevisions, requiredRevisions, observedRevisions, frames: observedRevisions.map((revision) => ({ revision, text: 'synthetic', code: '', tokenColors: [] })) })}`
    })
    .join('\n')
}

function resourceEvidence() {
  const rows = []
  const rawTrials = []
  for (const cycles of [20, 100, 500]) {
    const workload = `cycles-${cycles}`
    const windows = Array.from({ length: 6 }, () => ({
      cycles,
      elapsedMs: 1,
      retainedMessageNodes: 0,
      parserWasmReservedBeforeBytes: 3000,
      parserWasmReservedAfterBytes: 3000,
      jsHeapUsedBeforeBytes: 1000,
      jsHeapReservedBeforeBytes: 2000,
      jsHeapReservedAfterBytes: 2000,
      backingStorageBeforeBytes: 2000,
      jsHeapUsedAfterBytes: 1000 + cycles,
      backingStorageAfterBytes: 2000 + cycles,
      peakWasmReservedBytes: 3000 + cycles,
      simultaneousMessages: 4,
      peakMessageNodes: 4,
      queryObserversBefore: 0,
      queryObserversAfter: 0,
    }))
    const controls = windows.map((window) => ({ ...window }))
    for (const engine of ['remark', 'tree-sitter'] as const) {
      rows.push({
        workload,
        pair: 1,
        engine,
        status: 'OBSERVED_PLATEAU',
        schedule: {
          id: 'fixed-settle-2-tail-4-v1',
          settlingBatches: 2,
          tailBatches: 4,
          simultaneousMessages: 4,
        },
        jsLiveAfterGcBytes: windows.map((window) => window.jsHeapUsedAfterBytes),
        backingStorageAfterGcBytes: windows.map((window) => window.backingStorageAfterBytes),
        wasmReservationPeakBytes: windows.map((window) => window.peakWasmReservedBytes),
        controlJsLiveAfterGcBytes: controls.map((window) => window.jsHeapUsedAfterBytes),
        observedPersistentGrowth: false,
        observedWasmHighWaterReuse: engine === 'tree-sitter' ? true : null,
      })
      rawTrials.push({
        workload,
        pair: 1,
        engine,
        resourceWindows: windows,
        resourceControlWindows: controls,
      })
    }
  }
  return {
    provenance,
    frozenBudgetSha256: undefined,
    resourcePlateaus: rows,
    rawTrials,
    failures: [],
  }
}

async function assembleFixture(manifest: PromotionEvidenceAssemblyManifest) {
  const root = manifest.evidenceDirectory
  const reportPath = manifest.reports.qualification
  if (!reportPath) return assemblePromotionEvidence(manifest)
  const report = JSON.parse(await readFile(path.join(root, reportPath), 'utf8'))
  const source = {
    revision: provenance.revision,
    cleanTrackedDiff: provenance.trackedDiffSha256,
    lock: provenance.lockfileSha256,
    sourceClosure: provenance.sourceClosureSha256,
  }
  const artifactBindings = []
  for (const engine of ['remark', 'tree-sitter'] as const) {
    const runId = `browser-${engine}-qualify`
    if (!report.runs.some((run: { name: string }) => run.name === runId))
      report.runs.push({
        name: runId,
        exitCode: 0,
        tests: 102,
        passed: 102,
        failed: 0,
        pending: 0,
        todo: 0,
        log: `${engine}.log`,
      })
    const run = report.runs.find((entry: { name: string }) => entry.name === runId)
    const rawPath =
      (manifest.rawQualificationReports ?? []).find((entry) => entry.engine === engine)?.path ??
      `${engine}-bound-browser.json`
    const raw = (manifest.rawQualificationReports ?? []).some((entry) => entry.path === rawPath)
      ? JSON.parse(await readFile(path.join(root, rawPath), 'utf8'))
      : rawAssertions([])
    const rows = raw.testResults[0].assertionResults
    const filler = Array.from({ length: Math.max(0, run.tests - rows.length) }, (_, index) => ({
      fullName: `synthetic browser ${index}`,
      title: `synthetic browser ${index}`,
      status: 'passed',
    }))
    raw.testResults[0].assertionResults = rows.concat(filler)
    await writeFile(path.join(root, rawPath), JSON.stringify(raw))
    run.rawReport = rawPath
    const paths = [{ role: 'rawQualificationReport', path: rawPath }]
    const framePath = (manifest.frameLogs ?? []).find((file) =>
      file.startsWith(engine === 'remark' ? 'remark' : 'tree'),
    )
    if (framePath) {
      run.log = framePath
      paths.push({ role: 'frameLog', path: framePath })
    }
    const artifacts = await Promise.all(
      paths.map(async (entry) => {
        const bytes = await readFile(path.join(root, entry.path))
        return { ...entry, sha256: sha(bytes.toString()), byteLength: bytes.length }
      }),
    )
    artifactBindings.push({ runId, sourceBefore: source, sourceAfter: source, artifacts })
  }
  const packagePath = 'bound-package-tests.json'
  await writeFile(
    path.join(root, packagePath),
    JSON.stringify(
      rawAssertions(
        Array.from({ length: report.runs[0].tests }, (_, index) => `synthetic native ${index}`),
      ),
    ),
  )
  report.runs[0].rawReport = packagePath
  const packageRaw = JSON.parse(await readFile(path.join(root, packagePath), 'utf8'))
  for (let index = 0; index < report.runs[0].failed; index++)
    packageRaw.testResults[0].assertionResults[index].status = 'failed'
  await writeFile(path.join(root, packagePath), JSON.stringify(packageRaw))
  const packageBytes = await readFile(path.join(root, packagePath))
  artifactBindings.push({
    runId: 'package-tree-sitter',
    sourceBefore: source,
    sourceAfter: source,
    artifacts: [
      {
        role: 'rawQualificationReport',
        path: packagePath,
        sha256: sha(packageBytes.toString()),
        byteLength: packageBytes.length,
      },
    ],
  })
  const rasterPath = manifest.reports['paired-raster']
  if (rasterPath) {
    const raster = JSON.parse(await readFile(path.join(root, rasterPath), 'utf8'))
    await mkdir(path.join(root, 'images'), { recursive: true })
    const files = Array.from(
      new Set<string>(
        raster.compared.flatMap((row: { baseline: string; candidate: string }) => [
          row.baseline,
          row.candidate,
        ]),
      ),
    )
    for (const file of files) await writeFile(path.join(root, file), 'synthetic image bytes')
    const artifacts = await Promise.all(
      [rasterPath].concat(files).map(async (file) => {
        const bytes = await readFile(path.join(root, file))
        return {
          role: file === rasterPath ? 'pairedRasterReport' : 'pairedRasterImage',
          path: file,
          sha256: sha(bytes.toString()),
          byteLength: bytes.length,
        }
      }),
    )
    report.runs.push({
      name: 'paired-raster',
      tests: 128,
      passed: 128,
      failed: 0,
      pending: 0,
      todo: 0,
      exitCode: 0,
      log: rasterPath,
    })
    artifactBindings.push({
      runId: 'paired-raster',
      sourceBefore: source,
      sourceAfter: source,
      artifacts,
    })
  }
  report.artifactBindings = artifactBindings
  await writeFile(path.join(root, reportPath), JSON.stringify(report))
  const productionPath = manifest.reports['production-browser']
  if (productionPath) {
    const production = JSON.parse(await readFile(path.join(root, productionPath), 'utf8'))
    production.frozenBudgetSha256 = manifest.identity.budgetSha256
    await writeFile(path.join(root, productionPath), JSON.stringify(production))
  }
  return assemblePromotionEvidence(manifest)
}

test('assembles all fourteen typed receipts without weakening frozen denominators', async () => {
  const control = await fixture()
  await writeFile(
    path.join(control.directory, 'qualification.json'),
    JSON.stringify(qualification()),
  )
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest({ qualification: 'qualification.json' }),
  )
  const result = await assembleFixture(manifest)
  expect(result.evidence.receipts).toHaveLength(14)
  expect(result.evidence.receipts.map((entry) => entry.gate)).toHaveLength(14)
  expect(
    result.evidence.receipts.find((entry) => entry.gate === 'native-paired')?.counts.executed,
  ).toBe(0)
  expect(
    result.report.gates.find((entry) => entry.gate === 'native-heldout-semantics')?.reason,
  ).toContain('missing')
  expect(result.validation.verdict).toBe('NOT VERIFIED')
  expect(
    result.report.artifacts.some(
      (entry) => entry.path === 'qualification.json' && entry.sha256.length === 64,
    ),
  ).toBe(true)
})

test('reconciles exact named scenarios from both raw engine reports and frame markers', async () => {
  const control = await fixture()
  await writeFile(
    path.join(control.directory, 'qualification.json'),
    JSON.stringify(qualification()),
  )
  await writeFile(
    path.join(control.directory, 'remark-tests.json'),
    JSON.stringify(rawAssertions(Array.from(new Set(interactions.concat(safety))))),
  )
  await writeFile(
    path.join(control.directory, 'tree-tests.json'),
    JSON.stringify(rawAssertions(Array.from(new Set(interactions.concat(safety))))),
  )
  await writeFile(path.join(control.directory, 'remark.log'), frameLog('remark'))
  await writeFile(path.join(control.directory, 'tree.log'), frameLog('tree-sitter'))
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest(
      { qualification: 'qualification.json' },
      {
        rawQualificationReports: [
          { engine: 'remark', path: 'remark-tests.json' },
          { engine: 'tree-sitter', path: 'tree-tests.json' },
        ],
        frameLogs: ['remark.log', 'tree.log'],
      },
    ),
  )
  const result = await assembleFixture(manifest)
  expect(result.report.gates.find((entry) => entry.gate === 'interactions')).toMatchObject({
    selected: 4,
    complete: 4,
    failed: 0,
    skipped: 0,
    status: 'complete',
  })
  expect(result.report.gates.find((entry) => entry.gate === 'safety')).toMatchObject({
    selected: 4,
    complete: 4,
    failed: 0,
    skipped: 0,
    status: 'complete',
  })
  expect(result.report.gates.find((entry) => entry.gate === 'frame-probes')).toMatchObject({
    selected: 32,
    complete: 32,
    failed: 0,
    skipped: 0,
    status: 'inconclusive',
  })
})

test('reconciles frozen streaming assertions and frame receipts', async () => {
  const control = await fixture()
  await writeFile(
    path.join(control.directory, 'qualification.json'),
    JSON.stringify(qualification()),
  )
  await writeFile(
    path.join(control.directory, 'remark-tests.json'),
    JSON.stringify(rawAssertions(streamAssertions('remark'))),
  )
  await writeFile(
    path.join(control.directory, 'tree-tests.json'),
    JSON.stringify(rawAssertions(streamAssertions('tree-sitter'))),
  )
  await writeFile(path.join(control.directory, 'remark.log'), frameLog('remark'))
  await writeFile(path.join(control.directory, 'tree.log'), frameLog('tree-sitter'))
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest(
      { qualification: 'qualification.json' },
      {
        rawQualificationReports: [
          { engine: 'remark', path: 'remark-tests.json' },
          { engine: 'tree-sitter', path: 'tree-tests.json' },
        ],
        frameLogs: ['remark.log', 'tree.log'],
      },
    ),
  )
  const result = await assembleFixture(manifest)
  expect(result.report.gates.find((entry) => entry.gate === 'streaming-correctness')).toMatchObject(
    {
      selected: 88,
      complete: 88,
      failed: 0,
      skipped: 0,
      status: 'complete',
    },
  )
  expect(
    result.evidence.receipts.find((entry) => entry.gate === 'streaming-correctness')?.metrics,
  ).toMatchObject({ lostRevisions: 0, staleCompletionReceipts: 0, unexplainedDifferences: 0 })
})

test('derives visual parser arms while inline resource rows cannot authorize file-backed timing', async () => {
  const control = await producerQualificationFixture()
  const production = {
    ...resourceEvidence(),
    frozenBudgetSha256: control.manifest.identity.budgetSha256,
  }
  await writeFile(path.join(control.root, 'production.json'), JSON.stringify(production))
  const manifest = {
    ...control.manifest,
    reports: { ...control.manifest.reports, 'production-browser': 'production.json' },
  }
  const result = await assemblePromotionEvidence(manifest)
  expect(result.report.gates.find((entry) => entry.gate === 'visual-states')).toMatchObject({
    status: 'complete',
    complete: 128,
    failed: 0,
  })
  expect(
    result.evidence.receipts.find((entry) => entry.gate === 'visual-states')?.metrics,
  ).toMatchObject({ pairedEngineCount: 2, themeCount: 2, viewportWidthCount: 2 })
  expect(result.report.gates.find((entry) => entry.gate === 'resources')).toMatchObject({
    complete: 0,
    status: 'failed',
  })
  expect(
    result.evidence.receipts.find((entry) => entry.gate === 'resources')?.metrics,
  ).not.toHaveProperty('cachePlateauReached')
})

test.each(['grammar', 'chatGrammar'] as const)(
  'qualification independently rejects missing, duplicate, wrong-role and wrong-hash %s',
  async (kind) => {
    const control = await fixture()
    const report = qualification()
    const manifest = await parsePromotionEvidenceAssemblyManifest(
      control.manifest({ qualification: 'qualification.json' }),
    )
    const original = report.candidate.artifacts
    const controls = [
      original.filter((row) => row.kind !== kind),
      original.concat(original.filter((row) => row.kind === kind)),
      original.map((row) => (row.kind === kind ? { ...row, kind: 'wrong-role' } : row)),
      original.map((row) => (row.kind === kind ? { ...row, sha256: sha('wrong bytes') } : row)),
    ]
    for (const artifacts of controls) {
      await writeFile(
        path.join(control.directory, 'qualification.json'),
        JSON.stringify({
          ...report,
          candidate: { ...report.candidate, artifacts },
        }),
      )
      const result = await assemblePromotionEvidence(manifest)
      expect(result.report.findings).toContain(
        `qualification: ${kind} candidate artifact differs from sealed identity or is missing.`,
      )
      expect(
        result.validation.gates.find((row) => row.gate === 'candidate-capabilities')?.status,
      ).toBe('blocked')
    }
  },
)

test.each(['grammar.wasm', 'chat-grammar.wasm'])(
  'capability evidence rejects removal and mutation of actual %s bytes independently',
  async (file) => {
    const control = await fixture()
    await writeFile(
      path.join(control.directory, 'qualification.json'),
      JSON.stringify(qualification()),
    )
    const manifest = await parsePromotionEvidenceAssemblyManifest(
      control.manifest({ qualification: 'qualification.json' }),
    )
    const target = path.join(control.directory, file)
    const original = await readFile(target)
    await rm(target)
    const missing = await assemblePromotionEvidence(manifest)
    expect(
      missing.validation.gates.find((row) => row.gate === 'candidate-capabilities')?.status,
    ).toBe('blocked')
    expect(missing.report.findings.some((finding) => finding.includes(file))).toBe(true)
    await writeFile(target, 'changed grammar bytes')
    const changed = await assemblePromotionEvidence(manifest)
    expect(
      changed.validation.gates.find((row) => row.gate === 'candidate-capabilities')?.status,
    ).toBe('blocked')
    const role = file === 'grammar.wasm' ? 'base grammar' : 'CHAT grammar'
    expect(changed.validation.gates.flatMap((row) => row.findings)).toContain(
      `candidate-capabilities: missing actual pinned ${role} WASM artifact.`,
    )
    await writeFile(target, original)
  },
)

async function nativeResourceFixture() {
  const control = await fixture()
  const report = await syntheticNativeResources(control.directory, provenance)
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest({ 'native-resources': 'native-resources.json' }),
  )
  const save = async () => {
    await writeFile(path.join(control.directory, 'native-resources.json'), JSON.stringify(report))
    await writeFile(
      path.join(control.directory, 'native-resources.jsonl'),
      report.rawWindows.map((row) => JSON.stringify(row)).join('\n') + '\n',
    )
  }
  await save()
  return { ...control, report, manifest, save }
}

test('native resource consumer binds exactly the three native roles and actual captured bytes', async () => {
  const control = await nativeResourceFixture()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(
    result.report.findings.filter((finding) => finding.startsWith('native-resources:')),
  ).toEqual([])
  const receipt = result.evidence.receipts.find((entry) => entry.gate === 'resources')
  expect(receipt?.artifacts.map((row) => row.path)).toEqual(
    expect.arrayContaining([
      'native-resources.json',
      'native-resources.jsonl',
      'grammar.wasm',
      'chat-grammar.wasm',
      'resolver.wasm',
    ]),
  )
  expect(result.validation.verdict).toBe('NOT VERIFIED')
})

test('native resource sidecars resolve relative to their report directory', async () => {
  const control = await nativeResourceFixture()
  await mkdir(path.join(control.directory, 'resources'))
  const report = {
    ...control.report,
    candidate: {
      assets: control.report.candidate.assets.map((row) => ({ ...row, file: `../${row.file}` })),
    },
  }
  await writeFile(
    path.join(control.directory, 'resources/native-resources.json'),
    JSON.stringify(report),
  )
  await writeFile(
    path.join(control.directory, 'resources/native-resources.jsonl'),
    await readFile(path.join(control.directory, 'native-resources.jsonl')),
  )
  const manifest = await parsePromotionEvidenceAssemblyManifest({
    ...control.manifest,
    reports: { 'native-resources': 'resources/native-resources.json' },
  })
  const result = await assemblePromotionEvidence(manifest)
  expect(
    result.report.findings.filter((finding) => finding.startsWith('native-resources:')),
  ).toEqual([])
  const receipt = result.evidence.receipts.find((entry) => entry.gate === 'resources')!
  expect(receipt.artifacts.map((row) => row.path)).toEqual(
    expect.arrayContaining(['grammar.wasm', 'chat-grammar.wasm', 'resolver.wasm']),
  )
})

test.each(['grammar.wasm', 'chat-grammar.wasm'])(
  'native resource consumer rejects removed and mutated actual %s',
  async (file) => {
    const control = await nativeResourceFixture()
    await rm(path.join(control.directory, file))
    const missing = await assemblePromotionEvidence(control.manifest)
    expect(
      missing.report.findings.some(
        (finding) =>
          finding.startsWith('native-resources:') && finding.includes('asset file is missing'),
      ),
    ).toBe(true)
    await writeFile(path.join(control.directory, file), 'tampered bytes')
    const changed = await assemblePromotionEvidence(control.manifest)
    expect(
      changed.report.findings.some(
        (finding) =>
          finding.startsWith('native-resources:') && finding.includes('actual bytes differ'),
      ),
    ).toBe(true)
    expect(changed.validation.gates.find((entry) => entry.gate === 'resources')?.status).toBe(
      'blocked',
    )
  },
)

test.each([
  'missing',
  'duplicate',
  'wrong-role',
  'wrong-hash',
  'missing-file',
  'wrong-length',
  'extra',
] as const)('native resource consumer rejects %s CHAT capture', async (fault) => {
  const control = await nativeResourceFixture()
  const rows = control.report.candidate.assets
  const chat = rows.find((row) => row.asset === 'tree-sitter-markdown-chat.wasm')
  if (!chat) throw createScriptError('The CHAT fixture asset is missing.')
  if (fault === 'missing') rows.splice(1, 1)
  if (fault === 'duplicate') rows.push({ ...chat })
  if (fault === 'wrong-role') chat.asset = 'other.wasm'
  if (fault === 'wrong-hash') chat.sha256 = sha('wrong bytes')
  if (fault === 'missing-file') chat.file = 'missing.wasm'
  if (fault === 'wrong-length') chat.bytes++
  if (fault === 'extra') rows.push({ ...chat, asset: 'extra.wasm' })
  await control.save()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.report.findings.some((finding) => finding.startsWith('native-resources:'))).toBe(
    true,
  )
  expect(result.validation.gates.find((entry) => entry.gate === 'resources')?.status).toBe(
    'blocked',
  )
})

test.each([undefined, null, '', 'malformed', 'A'.repeat(64), 42])(
  'assembly manifests reject missing or malformed CHAT identity %s',
  async (chatGrammarSha256) => {
    const control = await fixture()
    const manifest = control.manifest()
    await expect(
      parsePromotionEvidenceAssemblyManifest({
        ...manifest,
        identity: { ...manifest.identity, chatGrammarSha256 },
      }),
    ).rejects.toThrow()
  },
)

test('preserves a failed raw qualification count and missing evidence as failed closed', async () => {
  const control = await fixture()
  const report = qualification(1)
  await writeFile(path.join(control.directory, 'qualification.json'), JSON.stringify(report))
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest({ qualification: 'qualification.json' }),
  )
  const result = await assembleFixture(manifest)
  expect(
    result.report.gates.find((entry) => entry.gate === 'native-development-semantics'),
  ).toMatchObject({ failed: 1, status: 'failed' })
  expect(
    result.report.findings.some((finding) => finding.includes('Held-out report is required')),
  ).toBe(true)
})

test('does not accept mismatched held-out identity or partial browser artifacts', async () => {
  const control = await fixture()
  await writeFile(
    path.join(control.directory, 'qualification.json'),
    JSON.stringify(qualification()),
  )
  await writeFile(
    path.join(control.directory, 'heldout.json'),
    JSON.stringify({
      schemaVersion: 1,
      candidate: {
        candidateCommit: 'b'.repeat(40),
        candidateSourceSha256: sha('other'),
        artifacts: {
          grammarSha256: sha('grammar'),
          chatGrammarSha256: sha('chat-grammar'),
          resolverSha256: sha('resolver'),
          lockfileSha256: sha('lock'),
        },
      },
      browser: {
        inputPath: 'missing-input.json',
        receiptPath: 'missing-receipt.json',
      },
    }),
  )
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest({
      qualification: 'qualification.json',
      heldout: 'heldout.json',
    }),
  )
  const result = await assembleFixture(manifest)
  expect(result.validation.verdict).toBe('NOT VERIFIED')
  expect(result.report.findings.some((finding) => finding.includes('candidateCommit'))).toBe(true)
  expect(
    result.report.gates.find((entry) => entry.gate === 'browser-heldout-semantics')?.reason,
  ).toContain('Invalid')
})

test('accepts coverage supersets without EMPTY aggregation contamination and rejects stale source', async () => {
  const control = await fixture()
  const report = qualification()
  report.runs[0] = { ...report.runs[0]!, tests: 1788, passed: 1788 }
  report.runs[1] = { ...report.runs[1]!, tests: 119, passed: 119 }
  await writeFile(path.join(control.directory, 'qualification.json'), JSON.stringify(report))
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest({ qualification: 'qualification.json' }),
  )
  const positive = await assembleFixture(manifest)
  expect(
    positive.report.gates.find((entry) => entry.gate === 'native-development-semantics'),
  ).toMatchObject({ status: 'complete', complete: 1788 })
  expect(
    positive.report.gates.find((entry) => entry.gate === 'browser-development-semantics'),
  ).toMatchObject({ status: 'complete', complete: 119 })
  const stale = JSON.parse(
    await readFile(path.join(control.directory, 'qualification.json'), 'utf8'),
  )
  stale.provenance.revision = 'b'.repeat(40)
  await writeFile(path.join(control.directory, 'qualification.json'), JSON.stringify(stale))
  const rejected = await assemblePromotionEvidence(manifest)
  expect(rejected.validation.verdict).toBe('NOT VERIFIED')
  expect(
    rejected.report.gates.find((entry) => entry.gate === 'native-development-semantics')?.status,
  ).toBe('inconclusive')
  expect(rejected.report.findings.some((finding) => finding.includes('provenance mismatch'))).toBe(
    true,
  )
})

test('rejects replaced same-count captured bytes and mismatched assertion denominators', async () => {
  const control = await fixture()
  await writeFile(
    path.join(control.directory, 'qualification.json'),
    JSON.stringify(qualification()),
  )
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest({ qualification: 'qualification.json' }),
  )
  await assembleFixture(manifest)
  const rawPath = path.join(control.directory, 'bound-package-tests.json')
  const raw = JSON.parse(await readFile(rawPath, 'utf8'))
  raw.testResults[0].assertionResults[0].title = 'replaced same count'
  await writeFile(rawPath, JSON.stringify(raw))
  const replaced = await assemblePromotionEvidence(manifest)
  expect(replaced.validation.verdict).toBe('NOT VERIFIED')
  expect(
    replaced.report.findings.some((finding) => finding.includes('capture hash/byteLength differs')),
  ).toBe(true)
  raw.testResults[0].assertionResults.pop()
  await writeFile(rawPath, JSON.stringify(raw))
  const partial = await assemblePromotionEvidence(manifest)
  expect(
    partial.report.findings.some((finding) =>
      finding.includes('raw assertion denominators differ'),
    ),
  ).toBe(true)
})

test('proves frame content assertions and rejects skipped or missing captured scenarios', async () => {
  const control = await fixture()
  await writeFile(
    path.join(control.directory, 'qualification.json'),
    JSON.stringify(qualification()),
  )
  const names = interactions.concat(
    safety,
    [
      'retains settled code state and every painted token color through append and completion',
      'the frame palette check rejects a changed color with the same token count',
      'never paints held heading markers or removes settled prose during release',
    ].map((title) => `real chat prefix projection ${title}`),
  )
  for (const engine of ['remark', 'tree-sitter'] as const) {
    await writeFile(
      path.join(control.directory, `${engine}-tests.json`),
      JSON.stringify(rawAssertions(names)),
    )
    await writeFile(path.join(control.directory, `${engine}.log`), frameLog(engine))
  }
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest(
      { qualification: 'qualification.json' },
      {
        rawQualificationReports: [
          { engine: 'remark', path: 'remark-tests.json' },
          { engine: 'tree-sitter', path: 'tree-sitter-tests.json' },
        ],
        frameLogs: ['remark.log', 'tree-sitter.log'],
      },
    ),
  )
  const positive = await assembleFixture(manifest)
  expect(positive.report.gates.find((entry) => entry.gate === 'frame-probes')).toMatchObject({
    status: 'complete',
    complete: 32,
  })
  const raw = JSON.parse(await readFile(path.join(control.directory, 'remark-tests.json'), 'utf8'))
  raw.testResults[0].assertionResults[0].status = 'pending'
  await writeFile(path.join(control.directory, 'remark-tests.json'), JSON.stringify(raw))
  const skipped = await assemblePromotionEvidence(manifest)
  expect(skipped.report.gates.find((entry) => entry.gate === 'interactions')?.status).toBe(
    'inconclusive',
  )
  expect(skipped.validation.verdict).toBe('NOT VERIFIED')
  const report = JSON.parse(
    await readFile(path.join(control.directory, 'qualification.json'), 'utf8'),
  )
  delete report.artifactBindings
  await writeFile(path.join(control.directory, 'qualification.json'), JSON.stringify(report))
  const missing = await assemblePromotionEvidence(manifest)
  expect(
    missing.report.findings.some((finding) =>
      finding.includes('capture-time artifactBindings/source context is missing'),
    ),
  ).toBe(true)
})

function syntheticPng() {
  const image = new PNG({ width: 4, height: 4 })
  for (let index = 0; index < 16; index++)
    image.data.set(index < 8 ? [0, 0, 0, 255] : [255, 255, 255, 255], index * 4)
  return PNG.sync.write(image)
}

async function producerQualificationFixture(
  externalCalibration = false,
  trusted?: Awaited<ReturnType<typeof trustedSyntheticFixture>>,
) {
  const control = await fixture(trusted?.evaluation.directory)
  const captured = trusted?.captured ?? provenance
  const root = control.directory
  const calibrationRoot = externalCalibration
    ? await mkdtemp(path.join(tmpdir(), 'promotion-calibration-'))
    : root
  if (externalCalibration) temporary.add(calibrationRoot)
  const runs: TestRun[] = []
  const rawQualificationReports: { engine: 'remark' | 'tree-sitter'; path: string }[] = []
  const frameLogs: string[] = []
  const browserLogs = new Map<'remark' | 'tree-sitter', string>()
  const webkitLogs = new Map<'remark' | 'tree-sitter', string>()
  const frameAssertions = [
    'retains settled code state and every painted token color through append and completion',
    'the frame palette check rejects a changed color with the same token count',
    'never paints held heading markers or removes settled prose during release',
  ].map((title) => `real chat prefix projection ${title}`)
  for (const engine of ['remark', 'tree-sitter'] as const) {
    const log = await syntheticVisualLog(root, engine, calibrationRoot)
    browserLogs.set(engine, log)
    const webkitLog = await syntheticVisualLog(root, engine, calibrationRoot, 'webkit')
    webkitLogs.set(engine, webkitLog)
    for (const domain of ['package', 'browser'] as const) {
      const name = domain === 'package' ? `package-${engine}` : `browser-${engine}-qualify`
      const selected =
        domain === 'package'
          ? streamAssertions(engine).filter(
              (title) => !title.startsWith('real chat prefix projection '),
            )
          : Array.from(
              new Set(
                interactions.concat(
                  safety,
                  FROZEN_SCENARIOS.resources ?? [],
                  frameAssertions,
                  streamAssertions(engine).filter((title) =>
                    title.startsWith('real chat prefix projection '),
                  ),
                ),
              ),
            )
      const total = domain === 'package' ? 1426 : 119
      const names = selected.concat(
        Array.from({ length: total - selected.length }, (_, index) => `${name} unrelated ${index}`),
      )
      const rawReport = path.join(root, `${name}-raw.json`)
      const logPath = path.join(root, `${name}.log`)
      await writeFile(rawReport, JSON.stringify(rawAssertions(names)))
      await writeFile(
        logPath,
        domain === 'browser' ? frameLog(engine) + '\n' + log + '\n' + webkitLog : '',
      )
      runs.push({
        name,
        tests: total,
        passed: total,
        failed: 0,
        pending: 0,
        todo: 0,
        exitCode: 0,
        rawReport,
        log: logPath,
      })
      rawQualificationReports.push({ engine, path: path.basename(rawReport) })
      if (domain === 'browser') frameLogs.push(path.basename(logPath))
    }
  }
  const raster = await compareRasterEvidence(
    browserLogs.get('remark') ?? '',
    browserLogs.get('tree-sitter') ?? '',
    path.dirname(root),
    root,
  )
  expect(raster.status).toBe('passed')
  const webkitRaster = await compareRasterEvidence(
    webkitLogs.get('remark') ?? '',
    webkitLogs.get('tree-sitter') ?? '',
    path.dirname(root),
    path.join(root, 'webkit'),
  )
  expect(webkitRaster.status).toBe('passed')
  const supplemental = webkitRaster.compared
    .filter((row) => WEBKIT_CRITICAL_IDS.includes(JSON.parse(row.key)[0]))
    .map((row) => ({
      ...row,
      baseline: `webkit/${row.baseline}`,
      candidate: `webkit/${row.candidate}`,
      overlay: `webkit/${row.overlay}`,
    }))
  const rasterPath = path.join(root, 'paired-raster.json')
  await writeFile(
    rasterPath,
    JSON.stringify({ ...raster, compared: raster.compared.concat(supplemental) }),
  )
  runs.push({
    name: 'paired-raster',
    log: rasterPath,
    tests: 128,
    passed: 128,
    failed: 0,
    pending: 0,
    todo: 0,
    exitCode: 0,
  })
  const source = qualificationSourceContext(captured)
  const report = {
    ...qualification(),
    provenance: captured,
    runs,
    checkExecution: { status: 'PASSED', exitCode: 0 },
    artifactBindings: await captureQualificationArtifacts(root, source, source, runs),
  }
  const manifest = await parsePromotionEvidenceAssemblyManifest(
    control.manifest(
      { qualification: 'qualification.json', 'paired-raster': 'paired-raster.json' },
      {
        rawQualificationReports,
        frameLogs,
        ...(trusted
          ? {
              identity: trusted.context.identity,
              nativeWorkloads: trusted.context.nativeWorkloads,
              expectedWorkloads: trusted.context.expectedWorkloads,
              frozenProvenance: {
                revision: captured.revision,
                trackedDiffSha256: captured.trackedDiffSha256,
                lockfileSha256: captured.lockfileSha256,
                sourceClosureSha256: captured.sourceClosureSha256,
              },
              trustedContext: trusted.options,
            }
          : {}),
      },
    ),
  )
  const save = async () => writeFile(path.join(root, 'qualification.json'), JSON.stringify(report))
  const recapture = async () => {
    report.artifactBindings = await captureQualificationArtifacts(root, source, source, report.runs)
    await save()
  }
  await save()
  return { root, manifest, report, save, recapture }
}

async function syntheticVisualLog(
  root: string,
  engine: 'remark' | 'tree-sitter',
  calibrationRoot: string,
  browser = 'chromium',
) {
  const lines: string[] = []
  const bytes = syntheticPng()
  for (const [width, theme] of [
    [390, 'light'],
    [390, 'dark'],
    [1440, 'light'],
    [1440, 'dark'],
  ] as const) {
    for (const fixture of VISUAL_STORY_IDS) {
      const screenshot = path.join(root, `${engine}-${browser}-${fixture}-${width}-${theme}.png`)
      await writeFile(screenshot, bytes)
      lines.push(
        `MARKDOWN_BROWSER_VISUAL ${JSON.stringify({ engine, fixture, browser, width, theme, screenshot })}`,
      )
    }
    const first = path.join(
      root,
      `${engine}-${browser}-${VISUAL_STORY_IDS[0]}-${width}-${theme}.png`,
    )
    const repeated = path.join(calibrationRoot, `${engine}-${browser}-repeat-${width}-${theme}.png`)
    await writeFile(repeated, bytes)
    lines.push(
      `MARKDOWN_BROWSER_CALIBRATION ${JSON.stringify({ engine, fixture: VISUAL_STORY_IDS[0], browser, width, theme, first, repeated })}`,
    )
  }
  return lines.join('\n')
}

test('accepts the actual paired-raster producer visual story matrix with fresh captured bindings', async () => {
  const control = await producerQualificationFixture()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.report.gates.find((entry) => entry.gate === 'visual-states')).toMatchObject({
    status: 'complete',
    complete: 128,
    failures: [],
  })
  expect(result.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).toBe(
    'passed',
  )
})

test.each(['failed', 'pending'] as const)(
  'retains freshly bound baseline %s execution outside selected candidate assertions',
  async (status) => {
    const control = await producerQualificationFixture()
    const index = control.report.runs.findIndex((run) => run.name === 'package-remark')
    const run = control.report.runs[index]!
    const raw = JSON.parse(await readFile(run.rawReport!, 'utf8'))
    raw.testResults[0].assertionResults.at(-1).status = status
    await writeFile(run.rawReport!, JSON.stringify(raw))
    control.report.runs[index] = {
      ...run,
      passed: run.tests - 1,
      failed: status === 'failed' ? 1 : 0,
      pending: status === 'pending' ? 1 : 0,
      exitCode: 1,
    }
    control.report.checkExecution = { status: 'FAILED', exitCode: 1 }
    await control.recapture()
    const result = await assemblePromotionEvidence(control.manifest)
    expect(result.validation.verdict).toBe('NOT VERIFIED')
    expect(
      result.report.findings.some(
        (finding) => finding.includes('package-remark') && finding.includes('required execution'),
      ),
    ).toBe(true)
    expect(result.report.findings.some((finding) => finding.includes('checkExecution'))).toBe(true)
    expect(
      result.evidence.receipts.find((entry) => entry.gate === 'native-development-semantics')
        ?.counts,
    ).toMatchObject({ executed: 1426, failed: 0, skipped: 0 })
  },
)

test('resource scenario metrics require exact captured browser assertions', async () => {
  const control = await producerQualificationFixture()
  const manifest = {
    ...control.manifest,
    reports: { ...control.manifest.reports, 'production-browser': 'resources.json' },
  }
  await writeFile(
    path.join(control.root, 'resources.json'),
    JSON.stringify({
      schemaVersion: 2,
      resourcePlateaus: resourceEvidence().resourcePlateaus,
      provenance,
    }),
  )
  const result = await assemblePromotionEvidence(manifest)
  const receipt = result.evidence.receipts.find((entry) => entry.gate === 'resources')!
  const name = FROZEN_SCENARIOS.resources![0]!
  expect(receipt.metrics[`scenario.${name}.executed`]).toBe(1)
  expect(receipt.metrics[`scenario.${name}.failed`]).toBe(0)
  expect(receipt.artifacts.some((entry) => entry.path === 'qualification.json')).toBe(true)
  expect(receipt.artifacts.some((entry) => entry.path === 'browser-remark-qualify-raw.json')).toBe(
    true,
  )
  const failures = result.report.gates.find((entry) => entry.gate === 'resources')!.failures
  expect(
    failures.filter((entry) => /scenario|capture|qualification:|checkExecution/.test(entry)),
  ).toEqual([])
  expect(result.validation.gates.find((entry) => entry.gate === 'resources')!.status).toBe(
    'blocked',
  )
})

test.each([
  'missing',
  'failed',
  'pending',
  'duplicate',
  'package-only',
  'changed-bytes',
  'stale-source',
  'wrong-run',
  'forged-path',
] as const)('resource scenario rejects %s actual-file evidence', async (mode) => {
  const control = await producerQualificationFixture()
  const name = FROZEN_SCENARIOS.resources![0]!
  const run = control.report.runs.find((entry) => entry.name === 'browser-remark-qualify')!
  const raw = JSON.parse(await readFile(run.rawReport!, 'utf8'))
  const rows = raw.testResults[0].assertionResults
  const selected = rows.find((row: { fullName: string }) => row.fullName === name)
  expect(selected).toBeDefined()
  if (mode === 'missing' || mode === 'package-only') selected.fullName = 'unrelated replacement'
  if (mode === 'failed' || mode === 'pending') selected.status = mode
  if (mode === 'duplicate') rows.push({ ...selected })
  if (mode === 'changed-bytes') selected.title = 'same assertion identity, altered capture bytes'
  await writeFile(run.rawReport!, JSON.stringify(raw))
  if (mode === 'package-only') await addPackageResourceScenario(control, name)
  if (mode !== 'changed-bytes') await control.recapture()
  const binding = control.report.artifactBindings.find((entry) => entry.runId === run.name)!
  control.report.artifactBindings = control.report.artifactBindings.map((entry) => {
    if (entry !== binding) return entry
    if (mode === 'stale-source')
      return {
        ...entry,
        sourceAfter: { ...entry.sourceAfter, sourceClosure: sha('different source') },
      }
    if (mode === 'wrong-run') return { ...entry, runId: 'browser-remark-forged' }
    if (mode === 'forged-path')
      return {
        ...entry,
        artifacts: entry.artifacts.filter((artifact) => artifact.role !== 'rawQualificationReport'),
      }
    return entry
  })
  await control.save()
  const manifest = {
    ...control.manifest,
    reports: { ...control.manifest.reports, 'production-browser': 'resources.json' },
  }
  await writeFile(
    path.join(control.root, 'resources.json'),
    JSON.stringify({
      schemaVersion: 2,
      resourcePlateaus: resourceEvidence().resourcePlateaus,
      provenance,
      metrics: { [`scenario.${name}.executed`]: 1, [`scenario.${name}.failed`]: 0 },
    }),
  )
  const result = await assemblePromotionEvidence(manifest)
  const resource = result.report.gates.find((entry) => entry.gate === 'resources')!
  expect(result.validation.gates.find((entry) => entry.gate === 'resources')!.status).toBe(
    'blocked',
  )
  expect(resource.failures.join(' ')).toMatch(/scenario|capture|unbound|required assertion/)
  if (mode === 'missing' || mode === 'package-only')
    expect(
      result.evidence.receipts.find((entry) => entry.gate === 'resources')!.metrics[
        `scenario.${name}.executed`
      ],
    ).toBe(0)
})

async function addPackageResourceScenario(
  control: Awaited<ReturnType<typeof producerQualificationFixture>>,
  name: string,
) {
  const run = control.report.runs.find((entry) => entry.name === 'package-remark')!
  const raw = JSON.parse(await readFile(run.rawReport!, 'utf8'))
  raw.testResults[0].assertionResults.at(-1).fullName = name
  await writeFile(run.rawReport!, JSON.stringify(raw))
}

test('legitimate visual producer calibration rejects retained changed bytes', async () => {
  const control = await producerQualificationFixture()
  const before = await assemblePromotionEvidence(control.manifest)
  expect(before.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).toBe(
    'passed',
  )
  const binding = control.report.artifactBindings.find((entry) => entry.runId === 'paired-raster')!
  const calibration = binding.artifacts.find(
    (entry) => entry.role === 'pairedRasterCalibration' && entry.path.includes('repeat'),
  )!
  expect(calibration).toBeDefined()
  const file = path.join(control.root, calibration.path)
  const bytes = await readFile(file)
  await writeFile(file, Buffer.concat([bytes, Buffer.from('replaced')]))
  const changed = await assemblePromotionEvidence(control.manifest)
  expect(
    changed.report.findings.some((finding) => finding.includes('capture hash/byteLength differs')),
  ).toBe(true)
})

test('requires every calibration declared by the legitimate visual producer', async () => {
  const control = await producerQualificationFixture()
  const binding = control.report.artifactBindings.find((entry) => entry.runId === 'paired-raster')!
  const calibration = binding.artifacts.find(
    (entry) => entry.role === 'pairedRasterCalibration' && entry.path.includes('repeat'),
  )!
  expect(calibration).toBeDefined()
  control.report.artifactBindings = control.report.artifactBindings.map((entry) =>
    entry.runId === 'paired-raster'
      ? {
          ...entry,
          artifacts: entry.artifacts.filter((artifact) => artifact.path !== calibration.path),
        }
      : entry,
  )
  await control.save()
  const missing = await assemblePromotionEvidence(control.manifest)
  expect(missing.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).not.toBe(
    'passed',
  )
  expect(
    missing.report.findings.some((finding) =>
      finding.includes('unbound paired raster calibration'),
    ),
  ).toBe(true)
})

test('preserves external calibration copies emitted by the actual capture producer', async () => {
  const control = await producerQualificationFixture(true)
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).toBe(
    'passed',
  )
  const binding = control.report.artifactBindings.find((entry) => entry.runId === 'paired-raster')!
  const copied = binding.artifacts.find(
    (entry) =>
      entry.role === 'pairedRasterCalibration' &&
      entry.path.startsWith('captured/pairedRasterCalibration/'),
  )!
  expect(copied).toBeDefined()
  await rm(path.join(control.root, copied.path))
  const missingBytes = await assemblePromotionEvidence(control.manifest)
  expect(
    missingBytes.validation.gates.find((entry) => entry.gate === 'visual-states')?.status,
  ).not.toBe('passed')
  expect(
    missingBytes.report.findings.some((finding) =>
      finding.includes('capture hash/byteLength differs'),
    ),
  ).toBe(true)
})

test('requires successful aggregate execution even when every raw assertion passes', async () => {
  const control = await producerQualificationFixture()
  control.report.checkExecution = { status: 'FAILED', exitCode: 1 }
  await control.save()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.report.findings.some((finding) => finding.includes('checkExecution'))).toBe(true)
  expect(
    result.validation.gates.filter((gate) => gate.status === 'passed').map((gate) => gate.gate),
  ).not.toContain('visual-states')
})

test('positively reconciles eight producer-shaped development and visual gates', async () => {
  const control = await producerQualificationFixture()
  const result = await assemblePromotionEvidence(control.manifest)
  const passed = result.validation.gates
    .filter((gate) => gate.status === 'passed')
    .map((gate) => gate.gate)
  expect(passed).toEqual([
    'candidate-capabilities',
    'native-development-semantics',
    'browser-development-semantics',
    'streaming-correctness',
    'interactions',
    'safety',
    'visual-states',
    'frame-probes',
  ])
  expect(result.validation.verdict).toBe('NOT VERIFIED')
})

function fixtureCommand(directory: string, command: string, args: readonly string[]) {
  const result = spawnSync(command, args, { cwd: directory, encoding: 'utf8', timeout: 30_000 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

async function writeSyntheticTree(root: string) {
  const directories = [
    'packages/markdown/src',
    'packages/markdown/test/evaluation',
    'apps/web/src/features/chat/components',
    'apps/web/src/features/chat/providers',
    'apps/web/src/features/chat/state',
    'apps/web/src/features/chat/utils',
    'apps/web/src/features/chat/tests',
    'scripts/markdown',
  ]
  for (const directory of directories) await mkdir(path.join(root, directory), { recursive: true })
  const files = [
    'editor/packages/tree-sitter/src/treeSitter/markdown.ts',
    'editor/packages/tree-sitter/test/wasm-memory.browser.test.ts',
    'editor/packages/tree-sitter/test/wasm-memory.test.ts',
    'apps/web/test/providers.tsx',
    'apps/web/test/factories/markdown-browser.tsx',
    'apps/web/test/factories/markdown-observation.ts',
    'apps/web/test/factories/markdown-production-assets.ts',
    'apps/web/test/factories/markdown-production-types.ts',
    'apps/web/test/factories/markdown-production.tsx',
    'apps/web/test/factories/markdown-timeline-scene.tsx',
    'apps/web/test/factories/qualification-image-command.ts',
    'apps/web/test/markdown-production.html',
    'apps/web/test/markdown-production.ts',
    'apps/web/vitest.markdown-qualification.config.ts',
    'apps/web/vite.config.ts',
    'apps/web/vitest.browser.config.ts',
  ]
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true })
    await writeFile(path.join(root, file), '')
  }
  await writeFile(path.join(root, '.gitignore'), 'node_modules/\nevidence/\n')
  await writeFile(path.join(root, 'bun.lock'), 'lockfile')
  await writeFile(path.join(root, 'package.json'), '{}')
  await writeFile(path.join(root, 'packages/markdown/package.json'), '{}')
  await writeFile(
    path.join(root, 'scripts/markdown/workloads.ts'),
    await readFile(new URL('./workloads.ts', import.meta.url)),
  )
  await writeFile(
    path.join(root, 'scripts/markdown/production-workloads.ts'),
    `export function productionTimingManifest() { return ${JSON.stringify(productionTimingManifest())} }\nexport function productionBrowserWorkloads() { return ${JSON.stringify(productionBrowserWorkloads().map(({ id, family }) => ({ id, family })))} }`,
  )
  const parser = path.join(root, 'node_modules/tree-sitter-md')
  const runtime = path.join(root, 'node_modules/web-tree-sitter')
  await mkdir(parser, { recursive: true })
  await mkdir(runtime, { recursive: true })
  await writeFile(
    path.join(parser, 'package.json'),
    JSON.stringify({
      name: 'tree-sitter-md',
      main: 'index.js',
      exports: {
        '.': './index.js',
        './tree-sitter-markdown.wasm': './tree-sitter-markdown.wasm',
        './tree-sitter-markdown-chat.wasm': './tree-sitter-markdown-chat.wasm',
        './tree-sitter-md.wasm': './tree-sitter-md.wasm',
      },
    }),
  )
  await writeFile(
    path.join(runtime, 'package.json'),
    JSON.stringify({ name: 'web-tree-sitter', main: 'web-tree-sitter.js' }),
  )
  const binaries = new Map<string, string>([
    ['tree-sitter-md/index.js', 'parser-binding'],
    ['tree-sitter-md/semantic.js', 'parser-semantics'],
    ['tree-sitter-md/constants.js', 'parser-constants'],
    ['tree-sitter-md/tree-sitter-markdown.wasm', 'grammar'],
    ['tree-sitter-md/tree-sitter-markdown-chat.wasm', 'chat-grammar'],
    ['tree-sitter-md/tree-sitter-md.wasm', 'resolver'],
    ['web-tree-sitter/web-tree-sitter.js', 'runtime-binding'],
    ['web-tree-sitter/web-tree-sitter.wasm', 'runtime-wasm'],
  ])
  for (const [file, bytes] of binaries)
    await writeFile(path.join(root, 'node_modules', file), bytes)
}

function syntheticMessages(): EvaluationMessage[] {
  return Array.from({ length: 100 }, (_, index) => {
    const source = `Owned ${index}.`
    return {
      id: `synthetic-${index}`,
      source,
      sha256: sha(source),
      createdDate: '2026-10-19',
      split: 'evaluation',
      provenance: {
        dataset: 'owned-synthetic-controls',
        revision: 'b'.repeat(40),
        license: 'MIT',
        url: 'https://example.test/owned',
      },
    }
  })
}

function syntheticNativeCases(input: ReturnType<typeof browserInput>): EvaluationCase[] {
  const digest = sha('synthetic projection')
  const check = (offset: number, live: boolean) => ({
    offset,
    live,
    status: 'passed' as const,
    baselineDigest: digest,
    candidateDigest: digest,
    failures: [],
    freshDigests: { baseline: digest, candidate: digest },
    difference: null,
  })
  return input.messages.map((message) => ({
    id: message.id,
    sourceSha256: message.sourceSha256,
    completed: check(message.source.length, false),
    streams: message.schedules.map((schedule) => ({
      schedule,
      checks: schedule.offsets
        .map((offset) => check(offset, true))
        .concat([check(message.source.length, false)]),
    })),
  }))
}

async function syntheticTrustedEvaluation(
  root: string,
  manifestSha256: string,
  batch: ReturnType<typeof syntheticBatch>,
  candidate: CandidateIdentity,
) {
  const directory = path.join(root, 'evidence')
  await mkdir(directory, { recursive: true })
  const input = browserInput(syntheticMessages(), candidate, batch)
  const inputPath = path.join(directory, 'browser-input.json')
  const inputBytes = JSON.stringify(input)
  await writeFile(inputPath, inputBytes)
  const observe = (source: string, live: boolean) => ({
    text: source,
    elements: [],
    inputSha256: sha(source),
    inputUtf16Units: source.length,
    live,
  })
  const collected = await collectBrowserEvaluation(
    input,
    { inputSha256: sha(inputBytes), productionBuildSha256: sha('synthetic build') },
    {
      show: async (_engine, source) => observe(source, false),
      run: async (_engine, source, chunks) => {
        const frames = chunks.map((chunk) => observe(chunk, true)).concat([observe(source, false)])
        return { frames, final: frames.at(-1) }
      },
    },
  )
  expect(collected.rawEvidence.failures).toEqual([])
  const receiptPath = path.join(directory, 'browser-receipt.json')
  const receiptBytes = JSON.stringify(collected.receipt)
  await writeFile(receiptPath, receiptBytes)
  const cases = syntheticNativeCases(input)
  const report = {
    schemaVersion: 1,
    status: 'passed',
    verdict: 'NOT VERIFIED',
    generatedAt: new Date().toISOString(),
    candidate,
    batch,
    manifestSha256,
    originalDenominator: 100,
    cases,
    counters: { ...evaluationCounts(cases), browserCases: { total: 100, passed: 100, failed: 0 } },
    browser: {
      inputSha256: sha(inputBytes),
      receiptSha256: sha(receiptBytes),
      productionBuildSha256: sha('synthetic build'),
      receiptPath,
      inputPath,
      failures: [],
    },
    missing: [],
    fatal: null,
  }
  const reportPath = path.join(directory, 'heldout.json')
  const reportBytes = JSON.stringify(report)
  await writeFile(reportPath, reportBytes)
  const ledgerDirectory = path.join(directory, 'ledger')
  await mkdir(ledgerDirectory)
  await writeFile(
    path.join(ledgerDirectory, `${batch.assetSha256}.json`),
    JSON.stringify({
      schemaVersion: 1,
      state: 'completed',
      batch,
      manifestSha256,
      candidate,
      exposedAt: report.generatedAt,
      receiptPath: reportPath,
      receiptSha256: sha(reportBytes),
      retirementReason: '',
    }),
  )
  return { directory, reportPath, ledgerDirectory }
}

function syntheticBatch() {
  return {
    file: 'oasst1-batch-999.json.gz',
    messages: 100 as const,
    sourceSha256: syntheticMessages().map((message) => message.sha256),
    assetSha256: sha('owned synthetic asset'),
    uncompressedSha256: sha('owned synthetic payload'),
    status: 'sealed' as const,
  }
}

async function syntheticCustody(
  root: string,
  manifest: Parameters<typeof sourceIdentity>[0],
  candidate: CandidateIdentity,
) {
  const time = '2026-01-01T00:00:00.000Z'
  const exclusions = {
    schemaVersion: 1,
    complete: true,
    recordedAt: time,
    groups: EXCLUSION_GROUPS.map((name) => ({ name, sourceSha256: [] })),
  }
  const evaluation = path.join(root, 'packages/markdown/test/evaluation')
  await writeFile(path.join(evaluation, 'LICENSE'), 'synthetic-license')
  await writeFile(path.join(root, 'scripts/markdown/snapshot-evaluation.ts'), 'synthetic-selector')
  await writeFile(
    path.join(evaluation, 'custody.json'),
    encoded({
      schemaVersion: 1,
      legacyManifestSha256: sha('synthetic legacy manifest'),
      records: [
        {
          kind: 'prospective-registration',
          batch: manifest.batches[0],
          source: sourceIdentity(manifest),
          licenseSha256: sha('synthetic-license'),
          selectorSha256: sha('synthetic-selector'),
          exclusions,
          exclusionsSha256: sha(encoded(exclusions)),
          freeze: {
            curator: 'synthetic-control',
            custodyStartedAt: time,
            ledgerDirectory: path.join(root, 'evidence/ledger'),
            parserFreeze: {
              commit: candidate.candidateCommit,
              sourceSha256: candidate.candidateSourceSha256,
              artifactsSha256: sha(encoded(candidate.artifacts)),
              frozenAt: time,
            },
          },
          selectionStartedAt: time,
          selectionCompletedAt: time,
          registeredAt: time,
          invocation: ['synthetic-control'],
        },
      ],
    }),
  )
}

function syntheticProvenance(root: string) {
  const module = fileURLToPath(new URL('./provenance.ts', import.meta.url))
  return JSON.parse(
    fixtureCommand(root, 'bun', [
      '--eval',
      `import {qualificationProvenance} from ${JSON.stringify(module)}; process.stdout.write(JSON.stringify(await qualificationProvenance(${JSON.stringify(root)})))`,
    ]),
  )
}

async function trustedSyntheticFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'promotion-trusted-'))
  temporary.add(root)
  await writeSyntheticTree(root)
  const batch = syntheticBatch()
  const manifest: Parameters<typeof sourceIdentity>[0] = {
    schemaVersion: 1,
    dataset: 'owned-synthetic-controls',
    revision: 'b'.repeat(40),
    license: 'MIT',
    asset: 'owned synthetic',
    assetSha256: sha('owned synthetic'),
    selection: 'owned synthetic controls only',
    batches: [batch],
  }
  const manifestBytes = JSON.stringify(manifest)
  await writeFile(path.join(root, 'packages/markdown/test/evaluation/manifest.json'), manifestBytes)
  fixtureCommand(root, 'git', ['init', '--quiet'])
  fixtureCommand(root, 'git', ['add', '.'])
  fixtureCommand(root, 'git', [
    '-c',
    'user.name=Synthetic fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'Synthetic source fixture',
  ])
  const captured = syntheticProvenance(root)
  const candidate: CandidateIdentity = {
    candidateCommit: captured.revision,
    candidateSourceSha256: captured.sourceClosureSha256,
    artifacts: {
      grammarSha256: sha('grammar'),
      chatGrammarSha256: sha('chat-grammar'),
      resolverSha256: sha('resolver'),
      runtimeWasmSha256: sha('runtime-wasm'),
      runtimeBindingSha256: sha('runtime-binding'),
      parserBindingSha256: sha('parser-binding'),
      parserSemanticsSha256: sha('parser-semantics'),
      parserConstantsSha256: sha('parser-constants'),
      lockfileSha256: sha('lockfile'),
    },
  }
  await syntheticCustody(root, manifest, candidate)
  fixtureCommand(root, 'git', ['add', '.'])
  fixtureCommand(root, 'git', [
    '-c',
    'user.name=Synthetic fixture',
    '-c',
    'user.email=fixture@example.test',
    '-c',
    'core.hooksPath=/dev/null',
    'commit',
    '--quiet',
    '-m',
    'Synthetic custody registration',
  ])
  const registered = syntheticProvenance(root)
  candidate.candidateCommit = registered.revision
  candidate.candidateSourceSha256 = registered.sourceClosureSha256
  const evaluation = await syntheticTrustedEvaluation(root, sha(manifestBytes), batch, candidate)
  const options = {
    root,
    evaluationReceipt: evaluation.reportPath,
    evaluationLedger: evaluation.ledgerDirectory,
    evidenceDirectory: evaluation.directory,
  }
  if (!('Bun' in globalThis)) Object.assign(globalThis, { Bun: { version: '1.3.fixture' } })
  const context = await createTrustedPromotionContext(options)
  return { root, context, options, captured: registered, evaluation, candidate }
}

test('trusted synthetic context binds prospective custody to its original ledger and artifacts', async () => {
  const fixture = await trustedSyntheticFixture()
  const custodyFile = path.join(fixture.root, 'packages/markdown/test/evaluation/custody.json')
  const original = await readFile(custodyFile, 'utf8')
  const custody = JSON.parse(original)
  const registered = custody.records[0]
  expect(registered.freeze.ledgerDirectory).toBe(fixture.options.evaluationLedger)
  expect(registered.freeze.parserFreeze.artifactsSha256).toBe(
    sha(encoded(fixture.candidate.artifacts)),
  )
  await rm(custodyFile)
  await expect(createTrustedPromotionContext(fixture.options)).rejects.toThrow()
  await writeFile(custodyFile, original)
  expect(fixtureCommand(fixture.root, 'git', ['status', '--porcelain=v1'])).toBe('')
  await expect(
    createTrustedPromotionContext({
      ...fixture.options,
      evaluationLedger: path.join(fixture.root, 'different-ledger'),
    }),
  ).rejects.toThrow()
})

test('uses an actual clean disposable candidate and completed synthetic100 ledger as trusted context', async () => {
  const fixture = await trustedSyntheticFixture()
  expect(
    fixtureCommand(fixture.root, 'git', ['status', '--porcelain=v1', '--untracked-files=all']),
  ).toBe('')
  expect(fixture.context.identity.grammarSha256).toBe(
    sha(
      await readFile(
        path.join(fixture.root, 'node_modules/tree-sitter-md/tree-sitter-markdown.wasm'),
      ),
    ),
  )
  expect(fixture.context.identity.chatGrammarSha256).toBe(
    sha(
      await readFile(
        path.join(fixture.root, 'node_modules/tree-sitter-md/tree-sitter-markdown-chat.wasm'),
      ),
    ),
  )
  expect(fixture.context.identity.chatGrammarSha256).not.toBe(
    fixture.context.identity.grammarSha256,
  )
  expect(fixture.captured.sources).toEqual(
    expect.arrayContaining(
      [
        'editor/packages/tree-sitter/src/treeSitter/markdown.ts',
        'editor/packages/tree-sitter/test/wasm-memory.browser.test.ts',
        'editor/packages/tree-sitter/test/wasm-memory.test.ts',
      ].map((file) => expect.objectContaining({ file })),
    ),
  )
  expect(fixture.context.benchmarkCells['pathological-scaling']).toBe(24)
  expect(fixture.context.nativeWorkloads).toHaveLength(75)
  expect(fixture.context.expectedWorkloads).toHaveLength(86)
  expect(fixture.context.heldoutCounts.nativeCases).toEqual({ total: 100, passed: 100, failed: 0 })
  expect(fixture.context.heldoutCounts.browserCases).toEqual({ total: 100, passed: 100, failed: 0 })
  const assembled = await assemblePromotionEvidence({
    schemaVersion: 1,
    evidenceDirectory: fixture.evaluation.directory,
    identity: fixture.context.identity,
    nativeWorkloads: fixture.context.nativeWorkloads,
    expectedWorkloads: fixture.context.expectedWorkloads,
    frozenProvenance: fixture.captured,
    reports: { heldout: 'heldout.json' },
    trustedContext: fixture.options,
  })
  const passed = assembled.validation.gates
    .filter((gate) => gate.status === 'passed')
    .map((gate) => gate.gate)
  expect(passed).toContain('native-heldout-semantics')
  expect(passed).toContain('browser-heldout-semantics')
  expect(assembled.validation.findings).not.toContain(
    'Authoritative current-candidate and unretired evaluation context is missing.',
  )
  expect(assembled.validation.verdict).toBe('NOT VERIFIED')
}, 60_000)

test.each(['tree-sitter-markdown.wasm', 'tree-sitter-markdown-chat.wasm'])(
  'trusted installed identity rejects removal and mutation of %s independently',
  async (asset) => {
    const fixture = await trustedSyntheticFixture()
    const file = path.join(fixture.root, 'node_modules/tree-sitter-md', asset)
    const original = await readFile(file)
    await rm(file)
    await expect(createTrustedPromotionContext(fixture.options)).rejects.toThrow()
    await writeFile(file, 'changed installed grammar')
    await expect(createTrustedPromotionContext(fixture.options)).rejects.toThrow()
    await writeFile(file, original)
  },
  60_000,
)

test('clears prior assembly outputs when current input cannot produce timing evidence', async () => {
  const control = await producerQualificationFixture()
  const manifestPath = path.join(control.root, 'assembly-input.json')
  await writeFile(manifestPath, JSON.stringify(control.manifest))
  const stale = path.join(control.root, 'assembled-native-timing-reconciliation.json')
  await writeFile(stale, JSON.stringify({ verdict: 'VERIFIED' }))
  const result = await fullAssemblySummary(manifestPath)
  expect(result).toMatchObject({ verdict: 'NOT VERIFIED', exit: 1, signal: null, error: null })
  expect(result.timing).toEqual([])
  await expect(readFile(stale)).rejects.toMatchObject({ code: 'ENOENT' })
  expect(result.files.map((file) => file.path)).toEqual([
    'assembled-evidence.json',
    'assembled-report.json',
  ])
}, 60_000)

test('verifies all fourteen gates from complete synthetic producer files and rejects changed or missing bytes', async () => {
  const trusted = await trustedSyntheticFixture()
  const fixture = await producerQualificationFixture(false, trusted)
  const timing = await writeFullSyntheticTiming({
    directory: fixture.root,
    sourceRoot: trusted.root,
    identity: trusted.context.identity,
    provenance: trusted.captured,
    resources: resourceEvidence(),
  })
  await syntheticNativeResources(fixture.root, trusted.captured)
  const manifest = await parsePromotionEvidenceAssemblyManifest({
    ...fixture.manifest,
    fontFingerprint: timing.fontFingerprint,
    reports: {
      ...fixture.manifest.reports,
      heldout: 'heldout.json',
      'paired-native': 'paired-native.json',
      'native-resources': 'native-resources.json',
      'production-browser': 'production-browser.json',
    },
    timingManifests: { native: 'native-input.json', production: 'production-input.json' },
  })
  const manifestPath = path.join(fixture.root, 'assembly-input.json')
  await writeFile(manifestPath, JSON.stringify(manifest))
  try {
    await fullAssemblyPositive(fixture.root, manifestPath, manifest)
  } finally {
    await fullAssemblyControls(fixture.root, manifestPath)
  }
}, 1_200_000)

async function fullAssemblyPositive(
  root: string,
  manifestPath: string,
  manifest: PromotionEvidenceAssemblyManifest,
) {
  const result = await fullAssemblySummary(manifestPath)
  console.log('SYNTHETIC_FULL14', JSON.stringify(result))
  expect.soft(result).toMatchObject({
    verdict: 'VERIFIED',
    finalArtifactVerdict: 'VERIFIED',
    exit: 0,
    signal: null,
    error: null,
    findings: [],
    gates: PROMOTION_GATES.map((gate) => ({ gate, status: 'passed', findings: [] })),
    nativeWorkloads: 75,
    expectedWorkloads: 86,
  })
  expect
    .soft(
      result.timing.map((entry) => [
        entry.kind,
        entry.verdict,
        entry.measured,
        entry.warmup,
        entry.comparisons,
      ]),
    )
    .toEqual([
      ['production', 'VERIFIED', 3440, 516, 344],
      ['native', 'VERIFIED', 3000, 450, 300],
    ])
  expect
    .soft(result.receipts.find((entry) => entry.gate === 'native-paired')?.counts)
    .toEqual({ executed: 1500, failed: 0, skipped: 0 })
  expect
    .soft(result.receipts.find((entry) => entry.gate === 'production-timing')?.counts)
    .toEqual({ executed: 1720, failed: 0, skipped: 0 })
  const native = JSON.parse(await readFile(path.join(root, 'paired-native.json'), 'utf8'))
  const production = JSON.parse(await readFile(path.join(root, 'production-browser.json'), 'utf8'))
  expect.soft(native.pairsArtifact.recordCount).toBe(1725)
  expect
    .soft(
      native.workloads.every(
        (row: NativeWorkloadSummary) =>
          row.observedPairs === 20 &&
          row.mismatchedPairs === 0 &&
          row.comparisons.every(
            (comparison) =>
              comparison.independentTrials === 20 &&
              comparison.baselineMs === (comparison.metric === 'streamCpu' ? 2 : 1) &&
              comparison.candidateMs === comparison.baselineMs,
          ),
      ),
    )
    .toBe(true)
  expect
    .soft(result.timing.find((entry) => entry.kind === 'native')?.metrics.observedWarmupTrials)
    .toBe(225)
  expect.soft(production.trialsArtifact.recordCount).toBe(3956)
  expect.soft(manifest.expectedWorkloads).toEqual(productionTimingManifest().workloads)
  console.log(
    'SYNTHETIC_STATISTICS',
    await readFile(path.join(root, 'raw-production-trials.jsonl.statistics.json'), 'utf8'),
    await readFile(path.join(root, 'raw-native-pairs.jsonl.statistics.json'), 'utf8'),
  )
}

async function fullAssemblyControls(root: string, manifestPath: string) {
  const grammar = path.join(root, 'assets/tree-sitter-markdown.wasm')
  const original = await readFile(grammar)
  try {
    await writeFile(grammar, 'changed grammar bytes')
    const tampered = await fullAssemblySummary(manifestPath)
    console.log('SYNTHETIC_TAMPERED', JSON.stringify(tampered))
    expect.soft(tampered).toMatchObject({
      verdict: 'NOT VERIFIED',
      exit: 1,
      signal: null,
      error: null,
    })
    expect
      .soft(
        tampered.timing
          .find((entry) => entry.kind === 'production')
          ?.findings.some(
            (entry: { kind: string; path: string }) =>
              entry.kind === 'mismatch' && entry.path.includes('tree-sitter-markdown.wasm'),
          ),
      )
      .toBe(true)
  } finally {
    await writeFile(grammar, original)
  }
  const capture = path.join(root, 'native-source-capture.json')
  const source = await readFile(capture)
  try {
    await rm(capture)
    const missing = await fullAssemblySummary(manifestPath)
    console.log('SYNTHETIC_MISSING', JSON.stringify(missing))
    expect.soft(missing).toMatchObject({
      verdict: 'NOT VERIFIED',
      exit: 1,
      signal: null,
      error: null,
    })
    expect
      .soft(missing.findings.some((entry: string) => entry.includes('native-source-capture.json')))
      .toBe(true)
    expect
      .soft(missing.gates.find((entry) => entry.gate === 'native-paired')?.status)
      .toBe('blocked')
  } finally {
    await writeFile(capture, source)
  }
  await fullRawControls(root, manifestPath)
  await fullSemanticControl(root, manifestPath, 'resource')
  await fullSemanticControl(root, manifestPath, 'last-input')
}

async function fullRawControls(root: string, manifestPath: string) {
  const file = await open(path.join(root, 'raw-production-trials.jsonl'), 'r+')
  const stats = JSON.parse(
    await readFile(path.join(root, 'raw-production-trials.jsonl.statistics.json'), 'utf8'),
  )
  try {
    await file.write(Buffer.from(' \n'), 0, 2, stats.byteLength - 1)
    const late = await fullAssemblySummary(manifestPath)
    console.log('SYNTHETIC_LATE_HASH', JSON.stringify(late))
    expect.soft(late).toMatchObject({
      verdict: 'NOT VERIFIED',
      exit: 1,
      signal: null,
      error: null,
    })
    expect
      .soft(
        late.timing
          .find((entry) => entry.kind === 'production')
          ?.findings.some((entry: { reason: string }) =>
            JSON.stringify(entry).includes('digest differs'),
          ),
      )
      .toBe(true)
    await file.truncate(stats.byteLength)
    await file.write(Buffer.from('\n'), 0, 1, stats.byteLength - 1)
    const record = Buffer.alloc(stats.lastWarmup.bytes)
    await file.read(record, 0, record.length, stats.lastWarmup.offset)
    const marker = record.indexOf('"userAgent":"synthetic"') + '"userAgent":"syntheti'.length
    expect(marker).toBeGreaterThan('"userAgent":"syntheti'.length)
    await file.write(Buffer.from('X'), 0, 1, stats.lastWarmup.offset + marker)
    const warmup = await fullAssemblySummary(manifestPath)
    console.log('SYNTHETIC_LAST_WARMUP_HASH', JSON.stringify(warmup))
    expect.soft(warmup).toMatchObject({
      verdict: 'NOT VERIFIED',
      exit: 1,
      signal: null,
      error: null,
    })
    expect
      .soft(
        warmup.timing
          .find((entry) => entry.kind === 'production')
          ?.findings.some((entry: unknown) => JSON.stringify(entry).includes('digest differs')),
      )
      .toBe(true)
    await file.write(record, 0, record.length, stats.lastWarmup.offset)
  } finally {
    await file.close()
  }
}

async function fullSemanticControl(
  root: string,
  manifestPath: string,
  kind: 'resource' | 'last-input',
) {
  const stats = JSON.parse(
    await readFile(path.join(root, 'raw-production-trials.jsonl.statistics.json'), 'utf8'),
  )
  const location = kind === 'resource' ? stats.firstResource : stats.lastRecord
  const file = await open(path.join(root, 'raw-production-trials.jsonl'), 'r+')
  const original = Buffer.alloc(location.bytes)
  await file.read(original, 0, original.length, location.offset)
  const text = original.toString('utf8')
  const marker = kind === 'resource' ? '"cycles":20' : '"freshCompleted":'
  const start = text.indexOf(marker)
  expect(start).toBeGreaterThan(-1)
  const index =
    kind === 'resource'
      ? start + marker.length - 1
      : text.indexOf('"inputSha256":"', start) + '"inputSha256":"'.length
  let replacement = text[index] === 'a' ? 'b' : 'a'
  if (kind === 'resource') replacement = '1'
  const reportPath = path.join(root, 'production-browser.json')
  const quietPath = path.join(root, 'production-quiet.json')
  const reportBytes = await readFile(reportPath, 'utf8')
  const quietBytes = await readFile(quietPath, 'utf8')
  try {
    await file.write(Buffer.from(replacement), 0, 1, location.offset + index)
    const report = JSON.parse(reportBytes)
    report.trialsArtifact = {
      ...report.trialsArtifact,
      ...(await hashFile({ root, file: 'raw-production-trials.jsonl' })),
    }
    const encoded = JSON.stringify(report)
    await writeFile(reportPath, encoded)
    await writeFile(
      quietPath,
      JSON.stringify({ ...JSON.parse(quietBytes), reportSha256: sha(encoded) }),
    )
    const result = await fullAssemblySummary(manifestPath)
    console.log(`SYNTHETIC_REHASHED_${kind}`, JSON.stringify(result))
    expect.soft(result).toMatchObject({
      verdict: 'NOT VERIFIED',
      exit: 1,
      signal: null,
      error: null,
    })
    if (kind === 'resource') {
      expect
        .soft(
          result.observations
            .find((entry) => entry.gate === 'resources')
            ?.failures.some((entry) => entry.includes('window cycles differ from workload')),
        )
        .toBe(true)
      expect.soft(result.gates.find((entry) => entry.gate === 'resources')?.status).toBe('blocked')
    }
    if (kind === 'last-input')
      expect
        .soft(
          result.timing
            .find((entry) => entry.kind === 'production')
            ?.findings.some(
              (entry: { kind: string; path: string }) =>
                entry.kind === 'mismatch' && entry.path.includes('freshCompleted'),
            ),
        )
        .toBe(true)
    expect
      .soft(
        result.timing
          .find((entry) => entry.kind === 'production')
          ?.findings.some((entry: unknown) => JSON.stringify(entry).includes('digest differs')),
      )
      .toBe(false)
  } finally {
    await file.write(original, 0, original.length, location.offset)
    await file.close()
    await writeFile(reportPath, reportBytes)
    await writeFile(quietPath, quietBytes)
  }
}

test('streams unique oracle files for synthetic measured and warmup arms', async () => {
  const control = await fixture()
  const workload = productionBrowserWorkloads().find(
    (entry) => entry.family === 'streaming-replay' && entry.sourceBytes <= 256,
  )!
  const rows = []
  for (const pair of [-1, 0]) {
    for (const engine of ['remark', 'tree-sitter'] as const) {
      rows.push(
        await writeSyntheticProductionArm(
          control.directory,
          syntheticProductionTemplate(workload, pair, engine),
        ),
      )
    }
  }
  expect(new Set(rows.map((row) => row.correctness.artifact.path)).size).toBe(4)
  const inputs = productionUpdates(workload).concat([workload.source])
  for (const row of rows) {
    const artifact = await hashFile({
      root: control.directory,
      file: row.correctness.artifact.path,
    })
    expect(artifact.sha256).toBe(row.correctness.artifact.sha256)
    expect(artifact.byteLength).toBe(row.correctness.artifact.byteLength)
    expect(row.correctness.artifact.recordCount).toBe(inputs.length + 2)
    expect(
      row.correctness.frames.every(
        (frame) => !('text' in frame) && frame.observationSha256.length === 64,
      ),
    ).toBe(true)
  }
  const artifacts = await reconcileProductionOracles({
    root: control.directory,
    first: rows[0]!,
    second: rows[1]!,
    inputs,
  })
  expect(artifacts).toHaveLength(2)
  await rm(path.join(control.directory, rows[0]!.correctness.artifact.path))
  await expect(
    reconcileProductionOracles({
      root: control.directory,
      first: rows[0]!,
      second: rows[1]!,
      inputs,
    }),
  ).rejects.toThrow()
})

test('requires supplemental WebKit while retaining the exact Chromium 128-state denominator', async () => {
  const control = await producerQualificationFixture()
  const positive = await assemblePromotionEvidence(control.manifest)
  expect(positive.validation.gates.find((row) => row.gate === 'visual-states')?.status).toBe(
    'passed',
  )
  expect(positive.report.gates.find((row) => row.gate === 'visual-states')).toMatchObject({
    selected: 128,
    complete: 128,
  })
  const file = path.join(control.root, 'paired-raster.json')
  const raster = JSON.parse(await readFile(file, 'utf8'))
  raster.compared = raster.compared.filter(
    (row: { key: string }) => JSON.parse(row.key)[1] === 'chromium',
  )
  await writeFile(file, JSON.stringify(raster))
  await control.recapture()
  const omitted = await assemblePromotionEvidence(control.manifest)
  expect(omitted.validation.gates.find((row) => row.gate === 'visual-states')?.status).toBe(
    'blocked',
  )
  expect(
    omitted.report.gates.find((row) => row.gate === 'visual-states')?.failures.join(' '),
  ).toContain('exact Chromium 128 and critical WebKit 32')
})

test.each([
  'missing-state',
  'duplicate-state',
  'wrong-browser',
  'extra-state',
  'nonrecord-state',
  'swapped-profile',
] as const)('rejects freshly bound WebKit %s', async (fault) => {
  const control = await producerQualificationFixture()
  const file = path.join(control.root, 'paired-raster.json')
  const raster = JSON.parse(await readFile(file, 'utf8'))
  const index = raster.compared.findIndex(
    (row: { key: string }) => JSON.parse(row.key)[1] === 'webkit',
  )
  const row = raster.compared[index]
  if (fault === 'missing-state') raster.compared.splice(index, 1)
  if (fault === 'duplicate-state') raster.compared[index + 1] = { ...row }
  if (fault === 'extra-state')
    raster.compared.push({ ...row, key: JSON.stringify(['extra-story', 'webkit', 390, 'light']) })
  if (fault === 'nonrecord-state') raster.compared.push(null)
  if (fault === 'wrong-browser') row.key = row.key.replace('webkit', 'firefox')
  if (fault === 'swapped-profile') row.key = row.key.replace('390', '391')
  await writeFile(file, JSON.stringify(raster))
  await control.recapture()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).toBe(
    'blocked',
  )
})

test.each([
  'missing-webkit-calibration',
  'calibration-bytes',
  'candidate-bytes',
  'overlay-bytes',
] as const)('rejects freshly rebound %s independently of producer success', async (fault) => {
  const control = await producerQualificationFixture()
  const run = control.report.runs.find((row) => row.name === 'browser-remark-qualify')!
  if (fault === 'missing-webkit-calibration') {
    const log = await readFile(run.log, 'utf8')
    await writeFile(
      run.log,
      log
        .split('\n')
        .filter(
          (line) => !line.includes('MARKDOWN_BROWSER_CALIBRATION ') || !line.includes('webkit'),
        )
        .join('\n'),
    )
  }
  const file = path.join(control.root, 'paired-raster.json')
  const raster = JSON.parse(await readFile(file, 'utf8'))
  const row = raster.compared.find((row: { key: string }) => JSON.parse(row.key)[1] === 'webkit')
  const changed = PNG.sync.read(syntheticPng())
  changed.data[0] = 127
  if (fault === 'calibration-bytes')
    await writeFile(
      path.join(control.root, 'remark-webkit-repeat-390-light.png'),
      PNG.sync.write(changed),
    )
  if (fault === 'candidate-bytes')
    await writeFile(path.join(control.root, row.candidate), PNG.sync.write(changed))
  if (fault === 'overlay-bytes')
    await writeFile(path.join(control.root, row.overlay), PNG.sync.write(changed))
  await control.recapture()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).toBe(
    'blocked',
  )
  expect(
    result.report.gates.find((entry) => entry.gate === 'visual-states')?.failures.join(' '),
  ).toMatch(/calibration|image bytes|overlay/)
})

test('requires native resources separately while a production browser report is present', async () => {
  const control = await producerQualificationFixture()
  await writeFile(
    path.join(control.root, 'production-browser.json'),
    JSON.stringify({
      ...resourceEvidence(),
      provenance,
      frozenBudgetSha256: control.manifest.identity.budgetSha256,
    }),
  )
  const manifest = {
    ...control.manifest,
    reports: { ...control.manifest.reports, 'production-browser': 'production-browser.json' },
  }
  const result = await assemblePromotionEvidence(manifest)
  expect(
    result.evidence.receipts.find((row) => row.gate === 'resources')?.metrics
      .nativeResourcesReconciled,
  ).toBe(false)
  expect(result.report.gates.find((row) => row.gate === 'resources')?.failures.join(' ')).toContain(
    'native-resources:',
  )
  expect(result.report.findings).toContain(
    'native-resources: required native resource report is missing.',
  )
})

test('reconciles complete synthetic native windows without qualifying absent browser proof', async () => {
  const control = await nativeResourceFixture()
  const result = await assemblePromotionEvidence(control.manifest)
  const gate = result.report.gates.find((row) => row.gate === 'resources')!
  expect(gate.failures.filter((failure) => failure.startsWith('native-resources:'))).toEqual([])
  expect(
    result.evidence.receipts.find((row) => row.gate === 'resources')?.metrics
      .nativeResourcesReconciled,
  ).toBe(true)
  expect(result.validation.gates.find((row) => row.gate === 'resources')?.status).toBe('blocked')
})

test.each([
  'failed-status',
  'inconclusive-status',
  'missing-window',
  'duplicate-window',
  'failed-output',
  'failed-cleanup',
  'retained-session',
  'zero-projections',
  'missing-group',
  'too-few-windows',
  'too-many-windows',
  'failed-summary',
  'duplicate-summary',
  'heap-growth',
  'wasm-growth',
  'missing-gc',
  'zero-before-wasm',
  'forged-summary',
  'exclusion',
  'wrong-source',
  'raw-failure',
] as const)(
  'native resource consumer independently rejects %s with browser report present',
  async (fault) => {
    const control = await nativeResourceFixture()
    const report = control.report
    const row = report.rawWindows[3]!
    if (fault === 'failed-status') report.nativeStatus = 'FAILED'
    if (fault === 'inconclusive-status') report.nativeStatus = 'INCONCLUSIVE'
    if (fault === 'missing-window') report.rawWindows.splice(3, 1)
    if (fault === 'duplicate-window') report.rawWindows[3] = report.rawWindows[2]!
    if (fault === 'failed-output') row.outputFailures.push('original output mismatch')
    if (fault === 'failed-cleanup') row.cleanupFailures.push('original cleanup failure')
    if (fault === 'retained-session') row.clearedSessions--
    if (fault === 'zero-projections') row.clearedProjectionEntries = 0
    if (fault === 'missing-group') report.rawWindows.splice(0, 4)
    if (fault === 'too-few-windows') report.rawWindows.splice(0, 2)
    if (fault === 'too-many-windows')
      report.rawWindows.push(
        ...Array.from({ length: 5 }, (_, index) => ({ ...row, window: index + 4 })),
      )
    if (fault === 'failed-summary') report.summaries[0]!.status = 'FAILED'
    if (fault === 'duplicate-summary') report.summaries[0] = report.summaries[1]!
    if (fault === 'heap-growth') row.after.heapUsedBytes++
    if (fault === 'wasm-growth') row.after.wasmReservedBytes++
    if (fault === 'missing-gc') row.before.gcPerformed = false
    if (fault === 'zero-before-wasm') row.before.wasmReservedBytes = 0
    if (fault === 'forged-summary') report.summaries[0]!.heapWindowDeltasBytes[2] = 1
    if (fault === 'exclusion') report.exclusions.push('window intentionally omitted')
    if (fault === 'wrong-source') report.sources[0]!.sha256 = sha('wrong source')
    if (fault === 'raw-failure') report.failures.push('candidate retains every session')
    await control.save()
    await writeFile(
      path.join(control.directory, 'production-browser.json'),
      JSON.stringify({
        ...resourceEvidence(),
        provenance,
        frozenBudgetSha256: control.manifest.identity.budgetSha256,
      }),
    )
    const manifest = {
      ...control.manifest,
      reports: { ...control.manifest.reports, 'production-browser': 'production-browser.json' },
    }
    const result = await assemblePromotionEvidence(manifest)
    const gate = result.report.gates.find((entry) => entry.gate === 'resources')!
    expect(
      gate.failures
        .concat(gate.exclusions)
        .some((finding) => finding.startsWith('native-resources:')),
    ).toBe(true)
    expect(result.validation.gates.find((entry) => entry.gate === 'resources')?.status).toBe(
      'blocked',
    )
    if (fault === 'raw-failure')
      expect(gate.failures).toContain('native-resources: candidate retains every session')
    if (fault === 'exclusion')
      expect(gate.exclusions).toContain('native-resources: window intentionally omitted')
  },
)

test.each(['missing', 'changed', 'missing-LF', 'extra-row', 'escaping-symlink'] as const)(
  'native resource consumer binds the original raw sidecar with %s rejection',
  async (fault) => {
    const control = await nativeResourceFixture()
    const file = path.join(control.directory, 'native-resources.jsonl')
    const original = await readFile(file, 'utf8')
    if (fault === 'missing' || fault === 'escaping-symlink') await rm(file)
    if (fault === 'changed') await writeFile(file, original.replace('1000', '1001'))
    if (fault === 'missing-LF') await writeFile(file, original.slice(0, -1))
    if (fault === 'extra-row') await writeFile(file, original + original.split('\n')[0] + '\n')
    if (fault === 'escaping-symlink') {
      const external = await mkdtemp(path.join(tmpdir(), 'native-raw-outside-'))
      temporary.add(external)
      await writeFile(path.join(external, 'raw.jsonl'), original)
      await symlink(path.join(external, 'raw.jsonl'), file)
    }
    const result = await assemblePromotionEvidence(control.manifest)
    expect(
      result.report.findings.some((finding) =>
        finding.startsWith('native-resources: original raw sidecar'),
      ),
    ).toBe(true)
    expect(result.validation.gates.find((row) => row.gate === 'resources')?.status).toBe('blocked')
  },
)

test('full synthetic producer fixture supplies explicitly synthetic production controls', () => {
  const controls = syntheticProductionControls()
  expect(controls.knownGood).toEqual({
    expected: sha('synthetic control output'),
    observed: sha('synthetic control output'),
    revision: 2,
    observedRevision: 2,
  })
  expect(controls.missingExpectation.rejected).toBe(true)
  expect(controls.wrongExpectation.rejected).toBe(true)
  expect(controls.longTask).toEqual({ supported: true, observed: [80] })
})

test('malformed native windows preserve original failure and exclusion evidence', async () => {
  const control = await nativeResourceFixture()
  const report = {
    ...control.report,
    rawWindows: null,
    failures: ['original native output failure'],
    exclusions: ['original excluded native observation'],
  }
  await writeFile(path.join(control.directory, 'native-resources.json'), JSON.stringify(report))
  const result = await assemblePromotionEvidence(control.manifest)
  const gate = result.report.gates.find((row) => row.gate === 'resources')!
  expect(gate.failures).toContain('native-resources: original native output failure')
  expect(gate.exclusions).toContain('native-resources: original excluded native observation')
  expect(result.validation.gates.find((row) => row.gate === 'resources')?.status).toBe('blocked')
})

test.each([3, 8])(
  'reconciles the native %i-window boundary from complete original data',
  async (windows) => {
    const control = await nativeResourceFixture()
    control.report.rawWindows = control.report.rawWindows
      .filter((row) => row.window === 0)
      .flatMap((row) => Array.from({ length: windows }, (_, window) => ({ ...row, window })))
    control.report.summaries = control.report.summaries.map((summary) => ({
      ...summary,
      windows,
      heapAfterReleaseBytes: Array<number>(windows).fill(1000),
      rssAfterReleaseBytes: Array<number>(windows).fill(2000),
      wasmReservedBytes: Array<number>(windows).fill(65536),
      heapWindowDeltasBytes: Array<number>(windows - 1).fill(0),
      rssWindowDeltasBytes: Array<number>(windows - 1).fill(0),
      wasmWindowDeltasBytes: Array<number>(windows - 1).fill(0),
    }))
    await control.save()
    const result = await assemblePromotionEvidence(control.manifest)
    expect(
      result.evidence.receipts.find((row) => row.gate === 'resources')?.metrics
        .nativeResourcesReconciled,
    ).toBe(true)
    expect(
      result.report.gates
        .find((row) => row.gate === 'resources')
        ?.failures.filter((failure) => failure.startsWith('native-resources:')),
    ).toEqual([])
  },
)

test('synthetic native warmups preserve correctness with distinct excluded timings', () => {
  const workload = {
    id: 'synthetic-native',
    family: 'warm-completed' as const,
    source: '**synthetic**',
    sourceBytes: 13,
    shape: 'mixed' as const,
    scheduleUnits: 4,
  }
  const warmup = syntheticNativeTrial(workload, -1, 'remark')
  const measured = syntheticNativeTrial(workload, 0, 'remark')
  expect(warmup.trial).toBe(-1)
  expect(measured.trial).toBe(0)
  expect(warmup.mountMs).toBe(11)
  expect(measured.mountMs).toBe(1)
  expect(warmup.streamCpuMs).toBe(22)
  expect(measured.streamCpuMs).toBe(2)
  expect(warmup.revisions.map((row) => ({ ...row, parseMs: 1, wallMs: 1, cpuMs: 1 }))).toEqual(
    measured.revisions,
  )
})

test.each([
  'remark-only',
  'hidden-candidate',
  'original-candidate-bytes',
  'cross-profile',
  'missing-webkit',
  'wrong-run',
  'duplicate-source',
  'wrong-engine',
  'wrong-fixture',
  'wrong-browser',
  'wrong-width',
  'wrong-profile',
] as const)('binds visual rows to original captures: %s', async (fault) => {
  const control = await producerQualificationFixture()
  const positive = await assemblePromotionEvidence(control.manifest)
  expect(positive.validation.gates.find((row) => row.gate === 'visual-states')?.status).toBe(
    'passed',
  )
  const file = path.join(control.root, 'paired-raster.json')
  const raster = JSON.parse(await readFile(file, 'utf8'))
  const row = raster.compared.find((entry: { key: string }) => {
    const tuple = JSON.parse(entry.key)
    return tuple[1] === 'webkit' && tuple[0] !== VISUAL_STORY_IDS[0]
  })
  const tuple = JSON.parse(row.key)
  if (fault === 'hidden-candidate' || fault === 'original-candidate-bytes') {
    const changed = PNG.sync.read(syntheticPng())
    changed.data[0] = 127
    await writeFile(
      path.join(control.root, `tree-sitter-webkit-${tuple[0]}-${tuple[2]}-${tuple[3]}.png`),
      PNG.sync.write(changed),
    )
  }
  if (fault === 'remark-only' || fault === 'hidden-candidate') {
    row.candidate = row.baseline
    row.overlay = row.baseline
  }
  if (fault === 'cross-profile') {
    row.baseline = raster.compared[0].baseline
    row.candidate = raster.compared[0].candidate
    row.overlay = raster.compared[0].overlay
  }
  await writeFile(file, JSON.stringify(raster))
  const run = control.report.runs.find((entry) => entry.name === 'browser-tree-sitter-qualify')!
  const lines = (await readFile(run.log, 'utf8')).split('\n')
  const marker = 'MARKDOWN_BROWSER_VISUAL '
  const original = lines.find(
    (line) =>
      line.startsWith(marker) &&
      line.includes(`"fixture":"${tuple[0]}"`) &&
      line.includes('"browser":"webkit"'),
  )!
  const record = JSON.parse(original.slice(marker.length))
  if (fault === 'missing-webkit')
    await writeFile(
      run.log,
      lines
        .filter((line) => !(line.startsWith(marker) && line.includes('"browser":"webkit"')))
        .join('\n'),
    )
  if (fault === 'duplicate-source') await writeFile(run.log, lines.concat(original).join('\n'))
  if (fault === 'wrong-run')
    control.report.runs[control.report.runs.indexOf(run)] = {
      ...run,
      name: 'browser-unrelated-qualify',
    }
  if (fault === 'wrong-engine') record.engine = 'remark'
  if (fault === 'wrong-fixture') record.fixture = 'unknown-fixture'
  if (fault === 'wrong-browser') record.browser = 'chromium'
  if (fault === 'wrong-width') record.width = 1440
  if (fault === 'wrong-profile') record.theme = 'dark'
  if (
    ['wrong-engine', 'wrong-fixture', 'wrong-browser', 'wrong-width', 'wrong-profile'].includes(
      fault,
    )
  )
    await writeFile(
      run.log,
      lines.map((line) => (line === original ? marker + JSON.stringify(record) : line)).join('\n'),
    )
  await control.recapture()
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.validation.gates.find((entry) => entry.gate === 'visual-states')?.status).toBe(
    'blocked',
  )
})

test.each(['posix', 'drive', 'unc'] as const)(
  'rejects absolute native asset declarations: %s',
  async (style) => {
    const control = await nativeResourceFixture()
    for (const asset of control.report.candidate.assets) {
      if (style === 'posix') asset.file = path.join(control.directory, asset.file)
      if (style === 'drive') asset.file = `C:\\evidence\\${asset.file}`
      if (style === 'unc') asset.file = `\\\\capture\\evidence\\${asset.file}`
    }
    await control.save()
    const result = await assemblePromotionEvidence(control.manifest)
    const findings = result.report.findings.filter((row) => row.startsWith('native-resources:'))
    expect(new Set(findings.filter((row) => row.includes('must be relative'))).size).toBe(3)
  },
)

test('preserves relative nested native assets when the evidence root moves', async () => {
  const control = await nativeResourceFixture()
  const nested = path.join(control.directory, 'nested')
  await mkdir(nested)
  const report = {
    ...control.report,
    rawWindows: control.report.rawWindows.toReversed(),
    candidate: {
      assets: control.report.candidate.assets.map((row) => ({ ...row, file: `../${row.file}` })),
    },
  }
  await writeFile(path.join(nested, 'renamed.json'), JSON.stringify(report))
  await writeFile(
    path.join(nested, 'native-resources.jsonl'),
    report.rawWindows.map((row) => JSON.stringify(row)).join('\n') + '\n',
  )
  const relocated = await mkdtemp(path.join(tmpdir(), 'promotion-relocated-'))
  temporary.add(relocated)
  const { cp } = await import('node:fs/promises')
  await cp(control.directory, relocated, { recursive: true })
  for (const evidenceDirectory of [control.directory, relocated]) {
    const result = await assemblePromotionEvidence({
      ...control.manifest,
      evidenceDirectory,
      reports: { 'native-resources': 'nested/renamed.json' },
    })
    expect(result.report.findings.filter((row) => row.startsWith('native-resources:'))).toEqual([])
  }
  await writeFile(
    path.join(nested, 'native-resources.jsonl'),
    report.rawWindows
      .toReversed()
      .map((row) => JSON.stringify(row))
      .join('\n') + '\n',
  )
  const reordered = await assemblePromotionEvidence({
    ...control.manifest,
    reports: { 'native-resources': 'nested/renamed.json' },
  })
  expect(reordered.report.findings).toContain(
    'native-resources: original raw sidecar windows differ from report.rawWindows.',
  )
})

test('rejects malformed UTF-8 in an otherwise matching native raw string field', async () => {
  const control = await nativeResourceFixture()
  const report = {
    ...control.report,
    rawWindows: control.report.rawWindows.map((row, index) =>
      index === 0 ? { ...row, extra: '\uFFFD' } : row,
    ),
  }
  await writeFile(path.join(control.directory, 'native-resources.json'), JSON.stringify(report))
  const text = report.rawWindows.map((row) => JSON.stringify(row)).join('\n') + '\n'
  const bytes = Buffer.from(text)
  const marker = Buffer.from('\uFFFD')
  const index = bytes.indexOf(marker)
  expect(index).toBeGreaterThan(-1)
  await writeFile(path.join(control.directory, 'native-resources.jsonl'), bytes)
  const positive = await assemblePromotionEvidence(control.manifest)
  expect(positive.report.findings.filter((row) => row.startsWith('native-resources:'))).toEqual([])
  await writeFile(
    path.join(control.directory, 'native-resources.jsonl'),
    Buffer.concat([
      bytes.subarray(0, index),
      Buffer.from([0xff]),
      bytes.subarray(index + marker.length),
    ]),
  )
  const result = await assemblePromotionEvidence(control.manifest)
  expect(
    result.report.findings.some(
      (row) => row.startsWith('native-resources:') && row.includes('invalid'),
    ),
  ).toBe(true)
  await writeFile(
    path.join(control.directory, 'native-resources.jsonl'),
    Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]),
  )
  const bom = await assemblePromotionEvidence(control.manifest)
  expect(
    bom.report.findings.some(
      (row) => row.startsWith('native-resources:') && row.includes('invalid'),
    ),
  ).toBe(true)
})

test.each(['remark', 'tree-sitter'] as const)(
  'requires original %s screenshot bytes even when the paired files pass',
  async (engine) => {
    const control = await producerQualificationFixture()
    const source = `${engine}-webkit-${WEBKIT_CRITICAL_IDS[1]}-390-light.png`
    await rm(path.join(control.root, source))
    const result = await assemblePromotionEvidence(control.manifest)
    expect(result.validation.gates.find((row) => row.gate === 'visual-states')?.status).toBe(
      'blocked',
    )
    expect(
      result.report.gates.find((row) => row.gate === 'visual-states')?.failures.join(' '),
    ).toContain(`${engine} original capture image bytes`)
  },
)

test('binds re-encoded paired PNG pixels and retains original file digests', async () => {
  const control = await producerQualificationFixture()
  const source = `tree-sitter-webkit-${WEBKIT_CRITICAL_IDS[1]}-390-light.png`
  const file = path.join(control.root, source)
  const original = await readFile(file)
  const reencoded = PNG.sync.write(PNG.sync.read(original), { deflateLevel: 0 })
  expect(reencoded.equals(original)).toBe(false)
  await writeFile(file, reencoded)
  const result = await assemblePromotionEvidence(control.manifest)
  expect(result.validation.gates.find((row) => row.gate === 'visual-states')?.status).toBe('passed')
  expect(
    result.evidence.receipts.find((row) => row.gate === 'visual-states')?.artifacts,
  ).toContainEqual({ path: source, sha256: sha(reencoded) })
  const changed = PNG.sync.read(reencoded)
  changed.data[0] = 127
  await writeFile(file, PNG.sync.write(changed))
  const mutated = await assemblePromotionEvidence(control.manifest)
  expect(mutated.validation.gates.find((row) => row.gate === 'visual-states')?.status).toBe(
    'blocked',
  )
})
