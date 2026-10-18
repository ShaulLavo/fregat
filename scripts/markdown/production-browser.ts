import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
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

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const WEB = path.join(ROOT, 'apps/web')
const ENGINES = ['remark', 'tree-sitter'] as const

type ProductionCapture =
  | { readonly kind: 'diagnostic' }
  | { readonly kind: 'promotion'; readonly hostEvidenceFile: string }
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
  const results: ProductionTrial[] = []
  const warmupResults: ProductionTrial[] = []
  const failures: string[] = []
  const interrupt = () => {
    void browser.close()
  }
  process.once('SIGINT', interrupt)
  process.once('SIGTERM', interrupt)
  let controls: Awaited<ReturnType<typeof productionBrowserControls>> | null = null
  try {
    actualBrowserArgs = await readBrowserArguments(browser)
    if (negativeControls)
      controls = await withProductionDeadline(
        productionBrowserControls(browser, url),
        'negative controls',
        45_000,
      )
    for (const workload of workloads)
      await measureWorkload({
        browser,
        url,
        output,
        workload,
        trials,
        warmups,
        results,
        warmupResults,
        failures,
        expectedSource,
        expectedBudgetSha256,
        onServedBuild: (identity) => {
          servedBuild ??= identity
        },
      })
  } finally {
    process.removeListener('SIGINT', interrupt)
    process.removeListener('SIGTERM', interrupt)
    await browser.close()
  }
  const comparisons = productionComparisons(results, workloads)
  const ordinaryFindings = ordinaryProductionFindings(results, workloads)
  const failedComparisons = comparisons.filter((comparison) => comparison.status === 'failed')
  const resourcePlateaus = results
    .filter((trial) => trial.family === 'resources')
    .map((trial) => ({
      workload: trial.workload,
      pair: trial.pair,
      engine: trial.engine,
      ...productionResourcePlateau(
        trial.resourceWindows,
        trial.resourceControlWindows,
        trial.engine === 'tree-sitter',
      ),
    }))
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
  const incompleteEvidence = results.flatMap((trial) => {
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
      return [
        `${trial.workload}/${trial.engine}: browser resource transfer receipts are incomplete.`,
      ]
    return []
  })
  const reportFailures = failures.concat(
    incompleteEvidence,
    ordinaryFindings,
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
    schemaVersion: 1,
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
    rawTrials: results,
    sampleSummaries: results.map(productionTrialSummary),
    controls,
    warmupResults,
    comparisons,
    resourcePlateaus,
    familyCoverage: productionFamilyCoverage(results, available),
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
      'Worker bootstrap completion can report headers after the body arrived before attachment. Its raw completionEncodedBytes is preserved, but full transfer bytes remain unknown without a worker request-start receipt.',
      'Paint receipts observe matching DOM after a frame opportunity; pixel/presentation and visual-state qualification are separate gates.',
      'Resource plateau verdict requires collected live-heap and repeated native reservation evidence; allocated JS heap alone cannot certify absence of a leak.',
      'Parser wall spans are observed in the actual session wrapper. Highlighter/loader/sanitizer/React CPU attribution and component render counts require the raw trace or a profiling build; no subtraction is presented as exclusive CPU.',
    ],
  }
  await writeFile(
    path.join(output, 'production-browser.json'),
    JSON.stringify(report, null, 2) + '\n',
  )
  await writeFile(
    path.join(output, 'raw-production-trials.jsonl'),
    results.map((trial) => JSON.stringify(trial)).join('\n') + '\n',
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

type MeasureWorkloadOptions = {
  readonly browser: Browser
  readonly url: string
  readonly output: string
  readonly workload: ProductionWorkload
  readonly trials: number
  readonly warmups: number
  readonly results: ProductionTrial[]
  readonly warmupResults: ProductionTrial[]
  readonly failures: string[]
  readonly expectedSource: Awaited<ReturnType<typeof qualificationProvenance>>
  readonly expectedBudgetSha256: string
  readonly onServedBuild: (identity: ServedBuildIdentity) => void
}

async function measureWorkload(options: MeasureWorkloadOptions) {
  for (let pair = -options.warmups; pair < options.trials; pair += 1) {
    const order = Math.abs(pair) % 2 === 0 ? 'AB' : 'BA'
    const results: ProductionTrial[] = []
    try {
      for (const engine of order === 'AB' ? ENGINES : ENGINES.toReversed())
        results.push(await oneTrial({ ...options, pair, order, engine }))
      const chunks = productionUpdates(options.workload)
      const expected = chunks.concat([options.workload.source])
      options.failures.push(
        ...productionPairFindings(results, expected).map(
          (finding) => `${options.workload.id}/pair-${pair}: ${finding}`,
        ),
      )
      if (pair < 0) options.warmupResults.push(...results)
      else options.results.push(...results)
    } catch (error) {
      if (pair < 0) options.warmupResults.push(...results)
      else options.results.push(...results)
      options.failures.push(
        `${options.workload.id}/pair-${pair}: ${error instanceof Error ? error.message : String(error)}`,
      )
      return
    }
  }
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
}: MeasureWorkloadOptions & {
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
    const chunks = productionUpdates(workload)
    await trialStage(directory, 'timing')
    instrumentation?.setPhase('measurement')
    const cpuBefore = await instrumentation?.read()
    const receipt = await withProductionDeadline(
      page.evaluate(
        async ({ source, chunks, arrival, arrivalOffsetsMs, expected }) =>
          window.markdownProductionProbe.time(source, chunks, {
            arrival,
            arrivalOffsetsMs,
            expected,
            heldSyntax: {
              held: 'Stable\n\n## ',
              released: 'Stable\n\n## Ready',
            },
          }),
        {
          source: workload.source,
          chunks,
          arrival: workload.arrival,
          arrivalOffsetsMs: productionArrivalOffsets(workload),
          expected: correctness.frames.map((frame) => frame.paintedOutput),
        },
      ),
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
    const correctness = await withProductionDeadline(
      page.evaluate(({ source, chunks }) => window.markdownProductionProbe.run(source, chunks), {
        source: workload.source,
        chunks: productionUpdates(workload),
      }),
      'independent projection replay',
      1_200_000,
    )
    const completed = await withProductionDeadline(
      page.evaluate((source) => window.markdownProductionProbe.run(source, []), workload.source),
      'fresh completed projection',
    )
    if (errors.length > 0)
      throw createScriptError('The independent production oracle reported a page error.', {
        internal: { errors },
      })
    return { correctness, freshCompleted: completed.final }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
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

async function listenerAbsent(url: string) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) })
    return false
  } catch {
    return true
  }
}

async function absent(file: string) {
  try {
    await access(file)
    return false
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
      return true
    throw error
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main()
