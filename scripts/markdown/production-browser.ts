import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, hostname, loadavg, release, totalmem } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Browser, type Page } from 'playwright'

import type {
  ProductionResourceControlWindow,
  ProductionResourceWindow,
} from '../../apps/web/test/factories/markdown-production-types'
import { startProductionCdp, isSustainedProductStream } from './production-cdp.ts'
import { mixedWorkload } from './workloads.ts'
import {
  productionBrowserWorkloads,
  productionTimingManifest,
  productionUpdates,
  productionArrivalOffsets,
  type ProductionWorkload,
} from './production-workloads.ts'
import {
  ordinaryProductionFindings,
  productionDigest,
  productionComparisons,
  productionMetricObservation,
  type ProductionMetricObservation,
  productionFamilyCoverage,
  productionPairFindings,
  productionTrialSummary,
  productionResourcePlateau,
  PRODUCTION_RESOURCE_SCHEDULE,
  type ProductionTrial,
} from './production-analysis.ts'
import { withProductionDeadline } from './production-deadline'
import { productionBrowserControls } from './production-controls.ts'
import { measureProductionTimeline } from './production-scenes.ts'
import { qualificationProvenance } from './provenance.ts'
import { createScriptError } from '../structured-errors.ts'
import { absent, listenerAbsent } from './production-cleanup.ts'
import { isRecord } from './serialization.ts'
import { writeJsonl } from './timing-artifacts'
import {
  oracleCallbackRecords,
  parseProductionOracleRecord,
  writeProductionOracle,
  retainPairedOracleMismatch,
  retainTimingOracleMismatch,
} from './production-oracle'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WEB = path.join(ROOT, 'apps/web')
const ENGINES = ['remark', 'tree-sitter'] as const

type ProductionCapture =
  | { readonly kind: 'diagnostic' }
  | { readonly kind: 'promotion'; readonly hostEvidenceFile: string }
type ProductionReplayInput = {
  readonly source: string
  readonly encodedInputs: readonly (number | string)[]
}

export function encodeProductionInputs(
  source: string,
  inputs: readonly string[],
): (number | string)[] {
  return inputs.map((input) => (source.startsWith(input) ? input.length : input))
}

export function replayProductionOracle({ source, encodedInputs }: ProductionReplayInput) {
  const chunks = encodedInputs.map((input) =>
    typeof input === 'number' ? source.slice(0, input) : input,
  )
  return window.markdownProductionProbe.streamOracle(source, chunks, (record) =>
    window.markdownOracleFrame(record),
  )
}

export async function replayProductionTiming({
  source,
  encodedInputs,
  arrival,
  arrivalOffsetsMs,
  expected,
}: ProductionReplayInput &
  Pick<
    Parameters<Window['markdownProductionProbe']['time']>[2],
    'arrival' | 'arrivalOffsetsMs' | 'expected'
  >) {
  const chunks = encodedInputs.map((input) =>
    typeof input === 'number' ? source.slice(0, input) : input,
  )
  return window.markdownProductionProbe.time(source, chunks, {
    arrival,
    arrivalOffsetsMs,
    expected,
    onMismatch: (sample) => window.markdownMismatchFrame(sample),
    heldSyntax: {
      held: 'Stable\n\n## ',
      released: 'Stable\n\n## Ready',
    },
  })
}

export async function buildMarkdownProductionProbe(output: string) {
  const sourceBefore = await qualificationProvenance(ROOT)
  const { build, loadConfigFromFile } = await import('vite')
  const loaded = await loadConfigFromFile(
    { command: 'build', mode: 'production' },
    path.join(WEB, 'vite.config.ts'),
    WEB,
  )
  if (!loaded) throw createScriptError('The production web configuration did not load.')
  await build({
    ...loaded.config,
    configFile: false,
    root: WEB,
    mode: 'production',
    define: {
      ...loaded.config.define,
      'import.meta.env.VITE_SERVER_URL': 'undefined',
    },
    build: {
      ...loaded.config.build,
      outDir: path.resolve(output),
      emptyOutDir: true,
      manifest: true,
      sourcemap: true,
      rollupOptions: {
        input: path.join(WEB, 'test/markdown-production.html'),
      },
    },
  })
  const assets = await readdir(path.join(output, 'assets'))
  const manifest = await readFile(path.join(output, '.vite', 'manifest.json'))
  const artifactHashes = await Promise.all(
    assets.map(async (file) => {
      const bytes = await readFile(path.join(output, 'assets', file))
      return { file, bytes: bytes.length, sha256: productionDigest(bytes) }
    }),
  )
  const sourceAfter = await qualificationProvenance(ROOT)
  await writeFile(
    path.join(output, 'markdown-probe-build.json'),
    JSON.stringify(
      {
        schemaVersion: 1,
        sourceBefore,
        sourceAfter,
        sourceConsistent: sourceBefore.sourceClosureSha256 === sourceAfter.sourceClosureSha256,
        artifactManifestSha256: productionDigest(manifest),
        wasm: artifactHashes.filter((artifact) => artifact.file.endsWith('.wasm')),
        artifacts: artifactHashes,
        budgetSha256: productionDigest(
          await readFile(new URL('./promotion-budget.json', import.meta.url)),
        ),
      },
      null,
      2,
    ) + '\n',
  )
}

export async function runProductionMarkdownPairs({
  url,
  output,
  trials = 20,
  warmups = 3,
  browserName = 'chromium',
  source,
  workloadIds,
  negativeControls = false,
  headless = true,
  browserArgs = [],
  executablePath,
  capture = { kind: 'diagnostic' },
}: {
  readonly url: string
  readonly output: string
  readonly trials?: number
  readonly warmups?: number
  readonly browserName?: 'chromium' | 'webkit'
  readonly source?: string
  readonly workloadIds?: readonly string[]
  readonly negativeControls?: boolean
  readonly headless?: boolean
  readonly browserArgs?: readonly string[]
  readonly executablePath?: string
  readonly capture?: ProductionCapture
}) {
  if (
    capture.kind === 'promotion' &&
    (process.platform !== 'darwin' || headless || browserName !== 'chromium')
  )
    throw createScriptError(
      'Promotion capture requires headed Chromium on the identified Mac host.',
    )
  const hostEvidence =
    capture.kind === 'promotion' ? await readHostEvidence(capture.hostEvidenceFile) : null
  const hostBefore = observeHost()
  const available = productionBrowserWorkloads()
  const selected = source === undefined ? available : customWorkload(source)
  const workloads = workloadIds
    ? selected.filter((entry) => workloadIds.includes(entry.id))
    : selected
  if (
    workloads.length === 0 ||
    workloadIds?.some((id) => !workloads.some((entry) => entry.id === id))
  )
    throw createScriptError('Production workload selection is empty or unknown.', {
      internal: { boundary: 'production-workloads' },
    })
  await mkdir(output, { recursive: true })
  const expectedSource = await qualificationProvenance(ROOT)
  const expectedBudgetSha256 = productionDigest(
    await readFile(new URL('./promotion-budget.json', import.meta.url)),
  )
  let servedBuild: ServedBuildIdentity | null = null
  const browser = await (browserName === 'webkit' ? webkit : chromium).launch({
    headless,
    args:
      browserName === 'chromium'
        ? ['--enable-automation'].concat(browserArgs)
        : Array.from(browserArgs),
    executablePath,
  })
  let actualBrowserArgs: readonly string[] | null = null
  const failures: string[] = []
  const interrupt = () => {
    void browser.close()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let controls: Awaited<ReturnType<typeof productionBrowserControls>> | null = null
  let observed: Awaited<ReturnType<typeof writeProductionTrials>>
  try {
    actualBrowserArgs = await readBrowserArguments(browser)
    if (negativeControls)
      controls = await withProductionDeadline(
        productionBrowserControls(browser, url),
        'negative controls',
        45_000,
      )
    observed = await writeProductionTrials({
      output,
      workloads,
      available,
      records: productionTrialRecords({
        workloads,
        trials,
        warmups,
        failures,
        retainMismatch: (results) => retainPairMismatch(output, results),
        capture: (trial) =>
          oneTrial({
            browser,
            url,
            output,
            ...trial,
            expectedSource,
            expectedBudgetSha256,
            onServedBuild: (identity) => {
              servedBuild ??= identity
            },
          }),
      }),
    })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await browser.close()
  }
  const { comparisons, resourcePlateaus, ordinaryFindings, incompleteEvidence } = observed
  const failedComparisons = comparisons.filter((comparison) => comparison.status === 'failed')
  if (
    controls &&
    (controls.knownGood.expected !== controls.knownGood.observed ||
      controls.knownGood.revision !== controls.knownGood.observedRevision ||
      !controls.missingExpectation.rejected ||
      !controls.wrongExpectation.rejected ||
      !controls.longTask.supported ||
      !controls.longTask.observed?.some((duration) => duration > 50))
  )
    failures.push(
      'A production measurement negative control was accepted or the known-good control failed.',
    )
  const reportFailures = failures.concat(
    incompleteEvidence,
    ordinaryFindings,
    comparisons.flatMap((comparison) =>
      comparison.metric === 'streamCpu'
        ? comparison.excludedPairs.map(
            (excluded) =>
              `${comparison.workload}/pair-${excluded.pair}/${excluded.engine}: ${excluded.reason}`,
          )
        : [],
    ),
    failedComparisons.map(
      (comparison) =>
        `${comparison.workload}: paired ${comparison.metric} confidence bound failed.`,
    ),
    resourcePlateaus
      .filter((entry) => entry.status === 'NOT VERIFIED')
      .map(
        (entry) =>
          `${entry.workload}/${entry.engine}: observed resource growth or failed native high-water reuse.`,
      ),
  )
  const report = {
    schemaVersion: 2 as const,
    build: 'production',
    timingStatus: capture.kind === 'promotion' ? 'PROMOTION_CAPTURE_UNRECONCILED' : 'EXPLORATORY',
    capture: { ...capture, hostEvidence },
    verdict: reportFailures.length > 0 ? 'NOT VERIFIED' : 'INCONCLUSIVE',
    browser: {
      name: browserName,
      version: browser.version(),
      headless,
      requestedArgs: browserArgs,
      actualArgs: actualBrowserArgs,
      executablePath: executablePath ?? null,
    },
    host: {
      id: hostname(),
      platform: process.platform,
      architecture: process.arch,
      hardware: cpus()[0]?.model ?? null,
      osRelease: release(),
      memoryBytes: totalmem(),
      before: hostBefore,
      after: observeHost(),
      loadQualification: hostEvidence ? 'SUPPLIED_UNRECONCILED' : 'NOT_ESTABLISHED',
    },
    provenance: expectedSource,
    servedBuild,
    frozenBudgetSha256: productionDigest(
      await readFile(new URL('./promotion-budget.json', import.meta.url)),
    ),
    workloadManifest: productionTimingManifest(),
    selectedWorkloads: workloads.map(({ source, ...entry }) => ({
      ...entry,
      sourceSha256: productionDigest(source),
    })),
    trials,
    warmups,
    trialsArtifact: observed.trialsArtifact,
    sampleSummaries: observed.sampleSummaries,
    controls,
    comparisons,
    resourcePlateaus,
    familyCoverage: observed.familyCoverage,
    failures: reportFailures,
    boundaries: {
      receiptToPaint:
        'Receipt until revision completion and matching DOM at a RAF-following task; browser paint opportunity, not pixel presentation confirmation.',
      perUpdateCpu:
        'Chrome trace thread ticks between revision start and React layout-effect completion; no wall-clock substitution.',
      totalCpu:
        'CDP main-thread task thread ticks plus worker RunTask thread CPU inside stream marks. Observation overhead remains included. Missing target mappings/ticks or boundary-crossing worker tasks make combined CPU incomplete; no wall time is substituted.',
      output:
        'Input hashes bind every completion. Paint digests must match an independent fully-ready real-component replay in a separate realm. Paired correctness compares every input revision; superseded or unobserved paints cannot pass.',
      pacing:
        'Independent producer deadlines, pinned 40ms or variable 12-48ms cadence; bursts of 32 every 40ms. Record scheduled/actual arrivals, every completion, superseded frames, and explicitly unsampled revisions.',
    },
    missing: [
      'Mermaid shadow-root output and component render counts are not yet part of the semantic projection digest; diagram and rendering qualification remain incomplete.',
      'Native retained buffer identities/counts are unmeasured; backing storage reports bytes only.',
      'Headed Mac capture accepts an explicit host evidence file and records actual browser arguments, fonts and host observations. Quiet timing qualification must still be reconciled against the final frozen candidate; supplying a file never grants VERIFIED.',
      'Worker CPU is counted from dedicated-worker RunTask thread ticks only when the trace maps each worker target and every counted task stays within the stream marks. Missing mappings, boundary-crossing tasks and worker replacement remain incomplete.',
      'Worker bootstrap completion can report headers after the body arrived before attachment. A complete dedicated-thread trace receipt adds response encoded bytes and encoded transfer-size updates; decoded body chunks remain diagnostic only.',
      'Paint receipts observe matching DOM after a frame opportunity; pixel/presentation and visual-state qualification are separate gates.',
      'Resource plateau verdict requires collected live-heap and repeated native reservation evidence; allocated JS heap alone cannot certify absence of a leak.',
      'Parser wall spans are observed in the actual session wrapper. Highlighter/loader/sanitizer/React CPU attribution and component render counts require the raw trace or a profiling build; no subtraction is presented as exclusive CPU.',
    ],
  }
  await writeFile(
    path.join(output, 'production-browser.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  return report
}

function observeHost() {
  return {
    observedAt: new Date().toISOString(),
    loadAverage: loadavg(),
    logicalCpus: cpus().length,
  }
}

async function readHostEvidence(file: string) {
  const raw = await readFile(file, 'utf8')
  const observation: unknown = JSON.parse(raw)
  if (!isRecord(observation) || observation.host !== hostname())
    throw createScriptError('Timing-host evidence must name this actual host.')
  if (
    typeof observation.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(observation.observedAt))
  )
    throw createScriptError('Timing-host evidence requires its observation timestamp.')
  return { sha256: productionDigest(raw), observation }
}

async function readBrowserArguments(browser: Browser): Promise<readonly string[] | null> {
  if (browser.browserType().name() !== 'chromium') return null
  const session = await browser.newBrowserCDPSession()
  try {
    return (await session.send('Browser.getBrowserCommandLine')).arguments
  } finally {
    await session.detach()
  }
}

type ProductionTrialCapture = (input: {
  readonly workload: ProductionWorkload
  readonly pair: number
  readonly order: ProductionTrial['order']
  readonly engine: ProductionTrial['engine']
}) => Promise<ProductionTrial>

type ProductionRecordsOptions = {
  readonly workloads: readonly ProductionWorkload[]
  readonly trials: number
  readonly warmups: number
  readonly failures: string[]
  readonly capture: ProductionTrialCapture
  readonly retainMismatch?: (trials: readonly ProductionTrial[]) => Promise<void>
}

export async function* productionTrialRecords(
  options: ProductionRecordsOptions,
): AsyncGenerator<ProductionTrial> {
  for (const workload of options.workloads) yield* measureWorkload(workload, options)
}

async function* measureWorkload(
  workload: ProductionWorkload,
  options: ProductionRecordsOptions,
): AsyncGenerator<ProductionTrial> {
  for (let pair = -options.warmups; pair < options.trials; pair += 1) {
    const result = yield* measureProductionPair(workload, pair, options)
    if (!result) return
  }
}

async function* measureProductionPair(
  workload: ProductionWorkload,
  pair: number,
  options: ProductionRecordsOptions,
): AsyncGenerator<ProductionTrial, boolean> {
  const order = Math.abs(pair) % 2 === 0 ? 'AB' : 'BA'
  const results: ProductionTrial[] = []
  try {
    for (const engine of order === 'AB' ? ENGINES : ENGINES.toReversed()) {
      const trial = await options.capture({ workload, pair, order, engine })
      results.push(trial)
      yield trial
    }
    const expected = productionUpdates(workload).concat([workload.source])
    options.failures.push(
      ...productionPairFindings(results, expected).map(
        (finding) => `${workload.id}/pair-${pair}: ${finding}`,
      ),
    )
    await options.retainMismatch?.(results)
    return true
  } catch (error) {
    options.failures.push(
      `${workload.id}/pair-${pair}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return false
  }
}

async function retainPairMismatch(output: string, trials: readonly ProductionTrial[]) {
  const first = trials.find((trial) => trial.engine === 'remark')
  const second = trials.find((trial) => trial.engine === 'tree-sitter')
  if (!first || !second) return
  if (
    first.correctness.frames.every(
      (frame, index) =>
        frame.paintedOutput.digest === second.correctness.frames[index]?.paintedOutput.digest,
    ) &&
    first.correctness.final.paintedOutput.digest === second.correctness.final.paintedOutput.digest
  )
    return
  await retainPairedOracleMismatch({
    root: output,
    file: path.join(path.dirname(second.correctness.artifact.path), 'paired-mismatch.json'),
    first,
    second,
  })
}

type ProductionWriteOptions = {
  readonly output: string
  readonly workloads: readonly ProductionWorkload[]
  readonly available: readonly ProductionWorkload[]
  readonly records: AsyncIterable<ProductionTrial>
}
type ProductionWriteState = {
  readonly observations: ProductionMetricObservation[]
  readonly sampleSummaries: ReturnType<typeof productionTrialSummary>[]
  readonly resourcePlateaus: ReturnType<typeof resourceObservation>[]
  readonly ordinaryFindings: string[]
  readonly incompleteEvidence: string[]
}

export async function writeProductionTrials(options: ProductionWriteOptions) {
  const state: ProductionWriteState = {
    observations: [],
    sampleSummaries: [],
    resourcePlateaus: [],
    ordinaryFindings: [],
    incompleteEvidence: [],
  }
  const trialsArtifact = await writeJsonl({
    root: options.output,
    file: 'raw-production-trials.jsonl',
    records: observedProductionRecords(options, state),
  })
  return {
    ...state,
    trialsArtifact,
    comparisons: productionComparisons(state.observations, options.workloads),
    familyCoverage: productionFamilyCoverage(state.observations, options.available),
  }
}

async function* observedProductionRecords(
  options: ProductionWriteOptions,
  state: ProductionWriteState,
) {
  for await (const trial of options.records) {
    if (trial.pair >= 0) observeProductionTrial(trial, options.workloads, state)
    yield trial
  }
}

function observeProductionTrial(
  trial: ProductionTrial,
  workloads: readonly ProductionWorkload[],
  state: ProductionWriteState,
) {
  state.observations.push(productionMetricObservation(trial))
  state.sampleSummaries.push(productionTrialSummary(trial))
  state.ordinaryFindings.push(...ordinaryProductionFindings([trial], workloads))
  state.incompleteEvidence.push(...incompleteNetworkEvidence(trial))
  if (trial.family === 'resources') state.resourcePlateaus.push(resourceObservation(trial))
}

function resourceObservation(trial: ProductionTrial) {
  return {
    workload: trial.workload,
    pair: trial.pair,
    engine: trial.engine,
    ...productionResourcePlateau(
      trial.resourceWindows,
      trial.resourceControlWindows,
      trial.engine === 'tree-sitter',
    ),
  }
}

function incompleteNetworkEvidence(trial: ProductionTrial) {
  if (trial.family !== 'resources' && trial.family !== 'payload') return []
  if (trial.network === null)
    return [`${trial.workload}/${trial.engine}: browser resource receipts are unavailable.`]
  if (
    trial.network.some(
      (request) =>
        request.transferredBytes === null &&
        request.failure === null &&
        request.resolvedByWorkerRequestId === null &&
        !isSustainedProductStream(request),
    )
  )
    return [`${trial.workload}/${trial.engine}: browser resource transfer receipts are incomplete.`]
  return []
}

async function retainBrowserMismatch(
  value: unknown,
  options: Omit<Parameters<typeof retainTimingOracleMismatch>[0], 'sample'>,
) {
  if (!isRecord(value)) throw createScriptError('Production mismatch payload is malformed.')
  const record = parseProductionOracleRecord({ kind: 'frame', frame: value.actual })
  const expectedIndex = value.expectedIndex
  if (typeof expectedIndex !== 'number' || !Number.isInteger(expectedIndex))
    throw createScriptError('Production mismatch expectation index is malformed.')
  const expected = options.oracle.frames[expectedIndex]?.paintedOutput
  if (
    !expected ||
    !isRecord(value.expected) ||
    value.expected.digest !== expected.digest ||
    value.expected.textBytes !== expected.textBytes ||
    value.expected.elementCount !== expected.elementCount
  )
    throw createScriptError('Production mismatch expectation is missing.')
  await retainTimingOracleMismatch({
    ...options,
    sample: { actual: record.frame, expected, expectedIndex },
  })
}

async function oneTrial({
  browser,
  url,
  output,
  workload,
  pair,
  order,
  engine,
  expectedSource,
  expectedBudgetSha256,
  onServedBuild,
}: {
  readonly browser: Browser
  readonly url: string
  readonly output: string
  readonly workload: ProductionWorkload
  readonly expectedSource: Awaited<ReturnType<typeof qualificationProvenance>>
  readonly expectedBudgetSha256: string
  readonly onServedBuild: (identity: ServedBuildIdentity) => void
  readonly pair: number
  readonly order: 'AB' | 'BA'
  readonly engine: (typeof ENGINES)[number]
}): Promise<ProductionTrial> {
  const directory = path.join(output, workload.id, `pair-${pair}-${engine}`)
  await mkdir(directory, { recursive: true })
  await trialStage(directory, 'oracle')
  const { correctness, freshCompleted } = await readOracle(
    browser,
    url,
    workload,
    engine,
    directory,
    output,
  )
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  let instrumentation: Awaited<ReturnType<typeof startProductionCdp>> | null = null
  const errors: string[] = []
  const onError = (error: Error) => errors.push(error.message)
  page.on('pageerror', onError)
  try {
    instrumentation =
      browser.browserType().name() === 'chromium' ? await startProductionCdp(page) : null
    const target = new URL(url)
    target.searchParams.set('engine', engine)
    const started = performance.now()
    await page.goto(target.href, { waitUntil: 'load' })
    const initialized = await withProductionDeadline(
      page.evaluate(() => window.markdownProductionProbe.ready),
      'parser initialization',
    )
    const navigationMs = performance.now() - started
    onServedBuild(await validateServedBuild(page, expectedSource, expectedBudgetSha256))
    const environment = await page.evaluate(() => ({
      userAgent: navigator.userAgent,
      concurrency: navigator.hardwareConcurrency,
      deviceScaleFactor: devicePixelRatio,
      viewport: { width: innerWidth, height: innerHeight },
      fontFamily: getComputedStyle(document.body).fontFamily,
      fonts: Array.from(document.fonts, (font) => ({
        family: font.family,
        status: font.status,
        weight: font.weight,
      })),
    }))
    if (initialized.engine !== engine)
      throw createScriptError('The production probe selected another engine.', {
        internal: { boundary: 'engine' },
      })
    instrumentation?.setPhase('prewarm')
    if (workload.cache === 'warm')
      await withProductionDeadline(
        page.evaluate(
          async (source) => window.markdownProductionProbe.run(source, []),
          workload.source,
        ),
        'warmup',
      )
    const encodedInputs = encodeProductionInputs(workload.source, productionUpdates(workload))
    await page.exposeBinding('markdownMismatchFrame', async (_source, value: unknown) =>
      retainBrowserMismatch(value, {
        root: output,
        file: path.join(directory, 'timing-mismatch.json'),
        engine,
        oracle: correctness,
      }),
    )
    await trialStage(directory, 'timing')
    instrumentation?.setPhase('measurement')
    const cpuBefore = await instrumentation?.read()
    const receipt = await withProductionDeadline(
      page.evaluate(replayProductionTiming, {
        source: workload.source,
        encodedInputs,
        arrival: workload.arrival,
        arrivalOffsetsMs: productionArrivalOffsets(workload),
        expected: correctness.frames.map((frame) => frame.paintedOutput),
      }),
      'timing replay',
      1_200_000,
    )
    const cpuAfter = await instrumentation?.read()
    instrumentation?.setPhase('scenes')
    await page.evaluate(
      (source) => window.markdownProductionProbe.show(source, false),
      workload.source,
    )
    await page.screenshot({ path: path.join(directory, 'replay-final.png') })
    await trialStage(directory, workload.scene)
    const timeline =
      workload.scene === 'timeline'
        ? await withProductionDeadline(
            measureProductionTimeline(page, workload.count, workload.source, directory),
            'actual timeline and input scene',
            45_000,
          )
        : null
    const resourceObservation =
      workload.scene === 'resources'
        ? await withProductionDeadline(
            resourceBatches(page, workload.source, workload.count, instrumentation),
            'actual resource lifecycle scene',
            Math.max(120_000, workload.count * 4000),
          )
        : null
    const resourceWindows = resourceObservation?.windows ?? null
    const resourceControlWindows = resourceObservation?.controls ?? null
    await trialStage(directory, 'trace')
    const trace = await instrumentation?.finishTrace(directory)
    const failedRequests =
      instrumentation?.network().filter((request) => request.failure !== null) ?? []
    if (failedRequests.length > 0) errors.push(`${failedRequests.length} network requests failed`)
    if (errors.length > 0)
      throw createScriptError('The production probe reported a page error.', {
        internal: { errors: errors.length },
      })
    await page.screenshot({ path: path.join(directory, 'final.png') })
    return {
      workload: workload.id,
      family: workload.family,
      pair,
      order,
      engine,
      arrival: workload.arrival,
      cache: workload.cache,
      navigationMs: workload.cache === 'cold' ? navigationMs : 0,
      initializationMs: initialized.initializationMs,
      environment,
      receipt,
      correctness,
      freshCompleted,
      cpu: cpuBefore && cpuAfter ? { before: cpuBefore, after: cpuAfter } : null,
      updateCpu: (trace?.updateCpu ?? []).filter(
        (tick) =>
          receipt.processed.some((input) => input.revision === tick.revision) ||
          receipt.heldSyntax?.held.revision === tick.revision ||
          receipt.heldSyntax?.released.revision === tick.revision,
      ),
      workers: instrumentation?.workers() ?? null,
      workerCpu: trace?.workerCpu ?? null,
      streamMainThreadCpuMs: trace?.streamMainThreadCpuMs ?? null,
      network: instrumentation?.network() ?? null,
      timeline,
      resourceWindows,
      resourceControlWindows,
    }
  } catch (error) {
    await writeFile(
      path.join(directory, 'failure.json'),
      JSON.stringify(
        {
          errors,
          failure: error instanceof Error ? error.message : String(error),
          network: instrumentation?.network() ?? null,
          workers: instrumentation?.workers() ?? null,
        },
        null,
        2,
      ) + '\n',
    )
    await Promise.allSettled([
      page.screenshot({
        path: path.join(directory, 'failure.png'),
        timeout: 5000,
      }),
      page.content().then((html) => writeFile(path.join(directory, 'failure.html'), html)),
    ])
    throw error
  } finally {
    page.removeListener('pageerror', onError)
    await page
      .evaluate(async () => window.markdownProductionProbe?.dispose())
      .catch(() => undefined)
    await instrumentation?.close().catch(() => undefined)
    await context.close()
  }
}

async function trialStage(directory: string, stage: string) {
  await writeFile(
    path.join(directory, 'progress.json'),
    JSON.stringify({ stage, timestamp: new Date().toISOString() }) + '\n',
  )
}

async function readOracle(
  browser: Browser,
  url: string,
  workload: ProductionWorkload,
  engine: string,
  directory: string,
  output: string,
) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    const target = new URL(url)
    target.searchParams.set('engine', engine)
    await page.goto(target.href, { waitUntil: 'load' })
    await withProductionDeadline(
      page.evaluate(() => window.markdownProductionProbe.ready),
      'oracle initialization',
    )
    if (workload.cache === 'warm')
      await withProductionDeadline(
        page.evaluate((source) => window.markdownProductionProbe.run(source, []), workload.source),
        'oracle warmup',
      )
    const captured = await writeProductionOracle({
      root: output,
      file: path.join(directory, 'oracle.jsonl'),
      engine,
      records: oracleCallbackRecords(async (emit) => {
        await page.exposeBinding('markdownOracleFrame', async (_source, value: unknown) =>
          emit(parseProductionOracleRecord(value)),
        )
        await withProductionDeadline(
          page.evaluate(replayProductionOracle, {
            source: workload.source,
            encodedInputs: encodeProductionInputs(workload.source, productionUpdates(workload)),
          }),
          'independent projection replay',
          1_200_000,
        )
      }),
    })
    if (errors.length > 0)
      throw createScriptError('The independent production oracle reported a page error.', {
        internal: { errors },
      })
    return captured
  } catch (error) {
    await writeFile(
      path.join(directory, 'oracle-failure.json'),
      JSON.stringify(
        {
          errors,
          failure: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ) + '\n',
    )
    await Promise.allSettled([
      page.screenshot({
        path: path.join(directory, 'oracle-failure.png'),
        timeout: 5000,
      }),
      page.content().then((html) => writeFile(path.join(directory, 'oracle-failure.html'), html)),
    ])
    throw error
  } finally {
    await page
      .evaluate(async () => window.markdownProductionProbe?.dispose())
      .catch(() => undefined)
    await context.close()
  }
}

async function resourceBatches(
  page: Page,
  source: string,
  cycles: number,
  instrumentation: Awaited<ReturnType<typeof startProductionCdp>> | null,
): Promise<{
  readonly windows: readonly ProductionResourceWindow[]
  readonly controls: readonly ProductionResourceControlWindow[]
}> {
  const schedule = Array.from(
    {
      length:
        PRODUCTION_RESOURCE_SCHEDULE.settlingBatches + PRODUCTION_RESOURCE_SCHEDULE.tailBatches,
    },
    () => cycles,
  )
  const windows: ProductionResourceWindow[] = []
  for (const batchCycles of schedule) {
    const before = await instrumentation?.collect()
    const measured: readonly ProductionResourceWindow[] = await page.evaluate(
      async ({ source, cycles }) => window.markdownProductionProbe.resources(source, [cycles], 4),
      { source, cycles: batchCycles },
    )
    const after = await instrumentation?.collect()
    const observedWindow = measured[0]
    if (!observedWindow) throw createScriptError('The production resource window was not observed.')
    windows.push({
      ...observedWindow,
      jsHeapUsedBeforeBytes: before?.jsHeapUsedBytes ?? observedWindow.jsHeapUsedBeforeBytes,
      jsHeapUsedAfterBytes: after?.jsHeapUsedBytes ?? observedWindow.jsHeapUsedAfterBytes,
      jsHeapReservedBeforeBytes:
        before?.jsHeapReservedBytes ?? observedWindow.jsHeapReservedBeforeBytes,
      jsHeapReservedAfterBytes:
        after?.jsHeapReservedBytes ?? observedWindow.jsHeapReservedAfterBytes,
      backingStorageBeforeBytes:
        before?.backingStorageBytes ?? observedWindow.backingStorageBeforeBytes,
      backingStorageAfterBytes:
        after?.backingStorageBytes ?? observedWindow.backingStorageAfterBytes,
    })
  }
  const controls = await resourceControlBatches(page, schedule, instrumentation)
  return { windows, controls }
}

async function resourceControlBatches(
  page: Page,
  schedule: readonly number[],
  instrumentation: Awaited<ReturnType<typeof startProductionCdp>> | null,
) {
  const results: ProductionResourceControlWindow[] = []
  for (const cycles of schedule) {
    const before = await instrumentation?.collect()
    const started = performance.now()
    await page.evaluate(
      (cycles) => window.markdownProductionProbe.resources(null, [cycles], 4),
      cycles,
    )
    const after = await instrumentation?.collect()
    results.push({
      cycles,
      elapsedMs: performance.now() - started,
      jsHeapUsedBeforeBytes: before?.jsHeapUsedBytes ?? null,
      jsHeapUsedAfterBytes: after?.jsHeapUsedBytes ?? null,
      backingStorageBeforeBytes: before?.backingStorageBytes ?? null,
      backingStorageAfterBytes: after?.backingStorageBytes ?? null,
    })
  }
  return results
}

type ServedBuildIdentity = {
  readonly revision: string
  readonly sourceClosureSha256: string
  readonly budgetSha256: string
  readonly artifactManifestSha256: string
  readonly artifactCount: number
}

async function validateServedBuild(
  page: Page,
  expectedSource: Awaited<ReturnType<typeof qualificationProvenance>>,
  expectedBudgetSha256: string,
): Promise<ServedBuildIdentity> {
  const served = await page.evaluate(async () => {
    const buildResponse = await fetch(new URL('../markdown-probe-build.json', location.href), {
      cache: 'no-store',
    })
    const manifestResponse = await fetch(new URL('../.vite/manifest.json', location.href), {
      cache: 'no-store',
    })
    return {
      buildStatus: buildResponse.status,
      build: await buildResponse.json(),
      manifestStatus: manifestResponse.status,
      manifest: await manifestResponse.text(),
    }
  })
  if (served.buildStatus !== 200 || served.manifestStatus !== 200)
    throw createScriptError('The served production build identity is incomplete.', {
      internal: { buildStatus: served.buildStatus, manifestStatus: served.manifestStatus },
    })
  return validateProductionBuildIdentity(
    served.build,
    served.manifest,
    expectedSource,
    expectedBudgetSha256,
  )
}

export function validateProductionBuildIdentity(
  build: unknown,
  manifest: string,
  expectedSource: Pick<
    Awaited<ReturnType<typeof qualificationProvenance>>,
    'revision' | 'trackedDiffSha256' | 'sourceClosureSha256' | 'lockfileSha256'
  >,
  expectedBudgetSha256: string,
): ServedBuildIdentity {
  if (!isRecord(build) || !isRecord(build.sourceAfter) || !isRecord(build.sourceBefore))
    throw createScriptError('The served production build identity is malformed.')
  const sourceAfter = build.sourceAfter
  const sourceBefore = build.sourceBefore
  if (
    build.sourceConsistent !== true ||
    sourceBefore.sourceClosureSha256 !== sourceAfter.sourceClosureSha256
  )
    throw createScriptError('The production source changed during its build.')
  if (
    sourceAfter.revision !== expectedSource.revision ||
    sourceAfter.trackedDiffSha256 !== expectedSource.trackedDiffSha256 ||
    sourceAfter.lockfileSha256 !== expectedSource.lockfileSha256
  )
    throw createScriptError(
      'The served build revision, working diff, or package pins do not match.',
    )
  const sourceClosureSha256 = stringField(sourceAfter, 'sourceClosureSha256')
  const revision = stringField(sourceAfter, 'revision')
  const budgetSha256 = stringField(build, 'budgetSha256')
  const artifactManifestSha256 = stringField(build, 'artifactManifestSha256')
  const artifacts = build.artifacts
  if (
    !sourceClosureSha256 ||
    !revision ||
    !budgetSha256 ||
    !artifactManifestSha256 ||
    !Array.isArray(artifacts)
  )
    throw createScriptError('The served production build identity is missing final bindings.')
  if (sourceClosureSha256 !== expectedSource.sourceClosureSha256)
    throw createScriptError(
      'The served production build is not bound to the current source closure.',
    )
  if (budgetSha256 !== expectedBudgetSha256)
    throw createScriptError('The served production build is not bound to the frozen budget.')
  if (productionDigest(manifest) !== artifactManifestSha256)
    throw createScriptError('The served artifact manifest does not match its build identity.')
  return {
    revision,
    sourceClosureSha256,
    budgetSha256,
    artifactManifestSha256,
    artifactCount: artifacts.length,
  }
}

function stringField(record: Record<string, unknown>, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value : null
}

function customWorkload(source: string): ProductionWorkload[] {
  const template = productionBrowserWorkloads().find((entry) => entry.scheduleUnits === 24)
  if (!template) throw createScriptError('The production stream template is missing.')
  return [
    {
      ...template,
      id: 'custom-smoke-fixed-24',
      source,
      sourceBytes: Buffer.byteLength(source),
    },
  ]
}

export async function main() {
  const { values } = parseArgs({
    options: {
      url: { type: 'string' },
      out: { type: 'string' },
      build: { type: 'string' },
      directory: { type: 'string' },
      port: { type: 'string' },
      trials: { type: 'string', default: '20' },
      warmups: { type: 'string', default: '3' },
      browser: { type: 'string', default: 'chromium' },
      workload: { type: 'string', multiple: true },
      smoke: { type: 'boolean', default: false },
      'negative-controls': { type: 'boolean', default: false },
      headed: { type: 'boolean', default: false },
      'browser-arg': { type: 'string', multiple: true },
      'browser-executable': { type: 'string' },
      capture: { type: 'string', default: 'diagnostic' },
      'host-evidence': { type: 'string' },
    },
  })
  if (values.build) await buildMarkdownProductionProbe(values.build)
  if (!values.url && !values.directory) return
  if (!values.out) throw createScriptError('Choose an output directory for the production probe.')
  const trials = Number(values.trials)
  const warmups = Number(values.warmups)
  if (!Number.isInteger(trials) || trials < 1 || !Number.isInteger(warmups) || warmups < 0)
    throw createScriptError('Production trials and warmups must be valid counts.')
  if (values.capture !== 'diagnostic' && values.capture !== 'promotion')
    throw createScriptError('Choose diagnostic or promotion capture.')
  if (values.capture === 'promotion' && !values['host-evidence'])
    throw createScriptError('Promotion capture requires explicit timing-host evidence.')
  const capture: ProductionCapture =
    values.capture === 'promotion' && values['host-evidence']
      ? { kind: 'promotion', hostEvidenceFile: values['host-evidence'] }
      : { kind: 'diagnostic' }
  if (values.browser !== 'chromium' && values.browser !== 'webkit')
    throw createScriptError('Unknown production browser.')
  const port = Number(values.port)
  if (values.directory && (!Number.isInteger(port) || port < 1 || port > 65535))
    throw createScriptError('Choose an explicit free loopback port for the production probe.')
  await mkdir(values.out, { recursive: true })
  await writeFile(
    path.join(values.out, 'resource-ownership.json'),
    JSON.stringify(
      {
        pid: process.pid,
        planned: {
          fixtureGatewayPort: values.directory ? port : null,
          browser: 'owned Playwright launch',
        },
        preserved: 'All pre-existing services, caches, and owner state.',
      },
      null,
      2,
    ) + '\n',
  )
  const gateway = values.directory
    ? await (
        await import('./production-server.ts')
      ).serveMarkdownProductionProbe(values.directory, port)
    : null
  let report: Awaited<ReturnType<typeof runProductionMarkdownPairs>>
  try {
    report = await runProductionMarkdownPairs({
      url: values.url ?? gateway?.url ?? '',
      output: values.out,
      trials,
      warmups,
      browserName: values.browser,
      workloadIds: values.workload,
      source: values.smoke ? mixedWorkload(256).source : undefined,
      negativeControls: values['negative-controls'],
      headless: !values.headed,
      browserArgs: values['browser-arg'],
      executablePath: values['browser-executable'],
      capture,
    })
  } finally {
    await gateway?.close()
    if (gateway)
      await writeFile(
        path.join(values.out, 'cleanup.json'),
        JSON.stringify(
          {
            workspaceAbsent: await absent(gateway.resources.workspace),
            stateHomeAbsent: await absent(gateway.resources.stateHome),
            listenerStopped: await listenerAbsent(gateway.url),
          },
          null,
          2,
        ) + '\n',
      )
  }
  process.stdout.write(
    JSON.stringify({
      verdict: report.verdict,
      failures: report.failures.length,
    }) + '\n',
  )
  if (report.failures.length > 0) process.exitCode = 1
}

export async function finalizeProductionCli(run: () => Promise<void>): Promise<never> {
  try {
    await run()
  } catch (error) {
    process.exitCode = 1
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    )
  }
  await Promise.all([flushProductionOutput(process.stdout), flushProductionOutput(process.stderr)])
  process.exit(process.exitCode ?? 0)
}

function flushProductionOutput(stream: NodeJS.WriteStream) {
  return new Promise<void>((resolve, reject) => {
    stream.once('error', reject)
    stream.end(resolve)
  })
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await finalizeProductionCli(main)
