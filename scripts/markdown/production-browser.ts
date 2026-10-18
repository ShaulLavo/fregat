import { access, mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { cpus, hostname } from 'node:os'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'
import { chromium, webkit, type Browser, type Page } from 'playwright'

import type { ProductionResourceWindow } from '../../apps/web/test/factories/markdown-production-types'
import { startProductionCdp } from './production-cdp.ts'
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
}: {
  readonly url: string
  readonly output: string
  readonly trials?: number
  readonly warmups?: number
  readonly browserName?: 'chromium' | 'webkit'
  readonly source?: string
  readonly workloadIds?: readonly string[]
  readonly negativeControls?: boolean
}) {
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
  const browser = await (browserName === 'webkit' ? webkit : chromium).launch({
    headless: true,
  })
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
      ...productionResourcePlateau(trial.resourceWindows),
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
      trial.network.some((request) => request.transferredBytes === null && request.failure === null)
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
    timingStatus: 'EXPLORATORY',
    verdict: reportFailures.length > 0 ? 'NOT VERIFIED' : 'INCONCLUSIVE',
    browser: { name: browserName, version: browser.version() },
    host: {
      id: hostname(),
      platform: process.platform,
      architecture: process.arch,
      hardware: cpus()[0]?.model ?? null,
      loadQualification: 'NOT_ESTABLISHED',
    },
    provenance: await qualificationProvenance(ROOT),
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
    resourcePlateaus: results
      .filter((trial) => trial.family === 'resources')
      .map((trial) => ({
        workload: trial.workload,
        pair: trial.pair,
        engine: trial.engine,
        ...productionResourcePlateau(trial.resourceWindows),
      })),
    familyCoverage: productionFamilyCoverage(results, available),
    failures: reportFailures,
    boundaries: {
      receiptToPaint:
        'Receipt until revision completion and matching DOM at a RAF-following task; browser paint opportunity, not pixel presentation confirmation.',
      perUpdateCpu:
        'Chrome trace thread ticks between revision start and React layout-effect completion; no wall-clock substitution.',
      totalCpu:
        'CDP main-thread task thread ticks over measured replay, including observation overhead. Worker CPU is absent when any worker was observed; it is never guessed.',
      output:
        'Input hashes bind every completion. Paint digests must match an independent fully-ready real-component replay in a separate realm. Paired correctness compares every input revision; superseded or unobserved paints cannot pass.',
      pacing:
        'Independent producer deadlines, pinned 40ms or variable 12-48ms cadence; bursts of 32 every 40ms. Record scheduled/actual arrivals, every completion, superseded frames, and explicitly unsampled revisions.',
    },
    missing: [
      'Mermaid shadow-root output and component render counts are not yet part of the semantic projection digest; diagram and rendering qualification remain incomplete.',
      'Native retained buffer identities/counts are unmeasured; backing storage reports bytes only.',
      'Quiet identified timing-host and font evidence must be supplied and reconciled on the final frozen candidate.',
      'Worker CPU attribution and worker replacement remain unmeasured when the product uses a worker. Current sessions run synchronously; no synthetic replacement is counted.',
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
    const resourceWindows =
      workload.scene === 'resources'
        ? await withProductionDeadline(
            resourceBatches(page, workload.source, workload.count, instrumentation),
            'actual resource lifecycle scene',
            Math.max(60_000, workload.count * 1500),
          )
        : null
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
      network: instrumentation?.network() ?? null,
      timeline,
      resourceWindows,
    }
  } catch (error) {
    await writeFile(
      path.join(directory, 'failure.json'),
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
      page.screenshot({ path: path.join(directory, 'oracle-failure.png'), timeout: 5000 }),
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
): Promise<ProductionResourceWindow[]> {
  const results: ProductionResourceWindow[] = []
  for (let batch = 0; batch < 4; batch += 1) {
    const before = await instrumentation?.collect()
    const windows = await page.evaluate(
      async ({ source, cycles }) => window.markdownProductionProbe.resources(source, [cycles], 4),
      { source, cycles },
    )
    const after = await instrumentation?.collect()
    for (const window of windows)
      results.push({
        ...window,
        jsHeapUsedBeforeBytes: before?.jsHeapUsedBytes ?? null,
        jsHeapUsedAfterBytes: after?.jsHeapUsedBytes ?? null,
        jsHeapReservedBeforeBytes: before?.jsHeapReservedBytes ?? null,
        jsHeapReservedAfterBytes: after?.jsHeapReservedBytes ?? null,
        backingStorageBeforeBytes: before?.backingStorageBytes ?? null,
        backingStorageAfterBytes: after?.backingStorageBytes ?? null,
      })
  }
  return results
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
    },
  })
  if (values.build) await buildMarkdownProductionProbe(values.build)
  if (!values.url && !values.directory) return
  if (!values.out) throw createScriptError('Choose an output directory for the production probe.')
  const trials = Number(values.trials)
  const warmups = Number(values.warmups)
  if (!Number.isInteger(trials) || trials < 1 || !Number.isInteger(warmups) || warmups < 0)
    throw createScriptError('Production trials and warmups must be valid counts.')
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
