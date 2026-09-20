import { gateFailures } from './bench-workspace.mjs'
import { runBrowserTrial as runTrial } from './bench-workspace.mjs'
import { diagnostic } from './bench-workspace.mjs'
import { defaultBrowsers } from './bench-workspace.mjs'
import { resolve } from 'node:path'
import { createBenchmarkError } from './structured-errors.mjs'
import {
  applyCpuThrottle,
  average,
  browserList,
  createWorkspaceContext,
  fractionOption,
  jumpToScrollFraction,
  measureCpuCalibration,
  median,
  minimum,
  numberOption,
  seedWorkspaceCache,
  traceUrl,
  waitForHighlightedEditor,
} from './bench-workspace.mjs'

const defaultAppUrl = 'http://localhost:5173/'
const defaultServerUrl = process.env.VITE_SERVER_URL ?? 'http://localhost:3001'
const defaultFilePath = 'apps/web/src/features/editor/components/editor.tsx'
const defaultRootPath = resolve(process.cwd(), '../..')
const options = parseOptions(process.argv.slice(2))

const gateThresholds = {
  chromium: {
    maxCssHighlightRanges: 270,
    // Uncapped frame throughput baseline is ~5ms/frame; 10 leaves ~2x
    // headroom for machine load without letting real regressions hide.
    maxMedianFrameMeanMs: 10,
    maxMeanRangesCount: 12,
    maxMeanRangesTotalMs: 15,
    maxMeanSegmentsCount: 12,
    maxMeanSegmentsTotalMs: 8,
  },
  firefox: {
    maxCssHighlightRanges: 270,
    maxBestFrameMeanMs: 30,
    maxMeanRangesCount: 12,
    maxMeanSegmentsCount: 12,
  },
  webkit: {
    maxCssHighlightRanges: 270,
    maxBestFrameMeanMs: 60,
    maxMeanRangesCount: 12,
    maxMeanRangesTotalMs: 20,
    maxMeanSegmentsCount: 12,
  },
}

const browserNames = options.browsers.length > 0 ? options.browsers : defaultBrowsers(options.gate)
const workspace = await createWorkspaceContext(options)
const results = {}

for (const browserName of browserNames) {
  results[browserName] = await runBrowserSamples(browserName, workspace)
}

console.log(`EDITOR_SCROLL_BENCHMARK_SUMMARY ${JSON.stringify(results, null, 2)}`)

if (options.gate) {
  const failures = gateFailures(results, gateThresholds, thresholdFailures)
  if (failures.length > 0) {
    console.error(`EDITOR_SCROLL_BENCHMARK_GATE_FAILED ${JSON.stringify(failures, null, 2)}`)
    process.exit(1)
  }

  console.log('EDITOR_SCROLL_BENCHMARK_GATE_PASSED')
}

function parseOptions(args) {
  const parsed = {
    appUrl: process.env.EDITOR_SCROLL_BENCH_APP_URL ?? defaultAppUrl,
    browsers: [],
    cpuThrottle: numberOption(process.env.EDITOR_SCROLL_BENCH_CPU_THROTTLE, 1),
    expectHighlights: true,
    filePath: process.env.EDITOR_SCROLL_BENCH_FILE ?? defaultFilePath,
    gate: false,
    pageTimeoutMs: numberOption(process.env.EDITOR_SCROLL_BENCH_PAGE_TIMEOUT_MS, 25_000),
    serverUrl: process.env.EDITOR_SCROLL_BENCH_SERVER_URL ?? defaultServerUrl,
    startFraction: fractionOption(process.env.EDITOR_SCROLL_BENCH_START_FRACTION, 0),
    stepPx: numberOption(process.env.EDITOR_SCROLL_BENCH_STEP_PX, 36),
    steps: numberOption(process.env.EDITOR_SCROLL_BENCH_STEPS, 80),
    trials: numberOption(process.env.EDITOR_SCROLL_BENCH_TRIALS, 3),
    workspaceRoot: process.env.EDITOR_SCROLL_BENCH_ROOT ?? defaultRootPath,
  }

  for (const arg of args) {
    applyOption(parsed, arg)
  }

  return parsed
}

function applyOption(parsed, arg) {
  if (arg === '--gate') {
    parsed.gate = true
    return
  }

  // For files with no syntax language (binary blobs, plain text); skips the
  // CSS highlight-registry readiness wait, which would otherwise time out.
  if (arg === '--no-highlights') {
    parsed.expectHighlights = false
    return
  }

  const [name, value] = arg.split('=')
  if (name === '--app-url') parsed.appUrl = value ?? parsed.appUrl
  if (name === '--browsers') parsed.browsers = browserList(value)
  if (name === '--cpu-throttle') parsed.cpuThrottle = numberOption(value, parsed.cpuThrottle)
  if (name === '--file') parsed.filePath = value ?? parsed.filePath
  if (name === '--page-timeout-ms') parsed.pageTimeoutMs = numberOption(value, parsed.pageTimeoutMs)
  if (name === '--server-url') parsed.serverUrl = value ?? parsed.serverUrl
  if (name === '--start-fraction')
    parsed.startFraction = fractionOption(value, parsed.startFraction)
  if (name === '--step-px') parsed.stepPx = numberOption(value, parsed.stepPx)
  if (name === '--steps') parsed.steps = numberOption(value, parsed.steps)
  if (name === '--trials') parsed.trials = numberOption(value, parsed.trials)
  if (name === '--workspace-root') parsed.workspaceRoot = value ?? parsed.workspaceRoot
}

async function runBrowserSamples(browserName, workspace) {
  const samples = []
  for (let trial = 1; trial <= options.trials; trial += 1) {
    const sample = await runTrial(browserName, trial, workspace, runTrialInBrowser)
    samples.push(sample)
    console.log(JSON.stringify({ type: 'editor-scroll-benchmark-trial', ...sample }))
  }

  return summarizeSamples(samples)
}

async function runTrialInBrowser(browser, browserName, trial, workspace) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  await seedWorkspaceCache(context, workspace)

  const page = await context.newPage()
  page.setDefaultTimeout(options.pageTimeoutMs)
  await page.goto(traceUrl(options.appUrl), { waitUntil: 'domcontentloaded' })
  await waitForHighlightedEditor(page, options.expectHighlights)
  await jumpToScrollFraction(page, options.startFraction, options.expectHighlights)
  await applyCpuThrottle(page, browserName, options.cpuThrottle)
  const cpuCalibrationMs = await measureCpuCalibration(page)
  const report = await runScrollSample(page)
  return trialSample(browserName, trial, report, cpuCalibrationMs)
}

async function runScrollSample(page) {
  const report = await page.evaluate(
    async ({ stepPx, steps }) => {
      const scroller = document.querySelector('.editor-virtualized')
      if (!scroller) return { error: 'Missing .editor-virtualized' }

      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      window.__editorPerfTrace.reset()
      for (let index = 0; index < steps; index += 1) {
        scroller.scrollTop += stepPx
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
        await new Promise((resolve) => requestAnimationFrame(resolve))
      }

      await new Promise((resolve) => setTimeout(resolve, 250))
      return window.__editorPerfTrace.report()
    },
    {
      stepPx: options.stepPx,
      steps: options.steps,
    },
  )
  if (report?.error) throw createBenchmarkError(report.error)

  return report
}

function trialSample(browserName, trial, report, cpuCalibrationMs) {
  const ranges = diagnostic(report, 'editor.tokenHighlights.ranges')
  const segments = diagnostic(report, 'editor.tokenHighlights.segments')
  return {
    browserName,
    trial,
    cpuCalibrationMs,
    cssHighlightRanges: report.dom.cssHighlightRanges,
    editorRows: report.dom.editorRows,
    frameMaxMs: report.frameStats.maxMs,
    frameMeanMs: report.frameStats.meanMs,
    longFrames: report.frameStats.longFrames,
    rangesCount: ranges.count,
    rangesTotalMs: ranges.totalMs,
    segmentsCount: segments.count,
    segmentsTotalMs: segments.totalMs,
    slowFrames: report.frameStats.slowFrames,
  }
}

function summarizeSamples(samples) {
  return {
    trials: samples.length,
    bestFrameMeanMs: minimum(samples.map((sample) => sample.frameMeanMs)),
    cssHighlightRanges: samples.at(-1)?.cssHighlightRanges ?? 0,
    meanCpuCalibrationMs: average(samples.map((sample) => sample.cpuCalibrationMs)),
    editorRows: samples.at(-1)?.editorRows ?? 0,
    meanFrameMaxMs: average(samples.map((sample) => sample.frameMaxMs)),
    meanFrameMeanMs: average(samples.map((sample) => sample.frameMeanMs)),
    meanLongFrames: average(samples.map((sample) => sample.longFrames)),
    meanRangesCount: average(samples.map((sample) => sample.rangesCount)),
    meanRangesTotalMs: average(samples.map((sample) => sample.rangesTotalMs)),
    meanSegmentsCount: average(samples.map((sample) => sample.segmentsCount)),
    meanSegmentsTotalMs: average(samples.map((sample) => sample.segmentsTotalMs)),
    meanSlowFrames: average(samples.map((sample) => sample.slowFrames)),
    medianFrameMeanMs: median(samples.map((sample) => sample.frameMeanMs)),
    samples,
  }
}

function thresholdFailures(browserName, summary, thresholds) {
  return Object.entries(thresholds).flatMap(([key, threshold]) => {
    const metric = metricForThreshold(summary, key)
    if (metric <= threshold) return []

    return [{ browserName, key, metric, threshold }]
  })
}

function metricForThreshold(summary, key) {
  const metricName = key.replace(/^max/, '')
  return summary[lowercaseFirst(metricName)] ?? Number.POSITIVE_INFINITY
}

function lowercaseFirst(value) {
  return value.charAt(0).toLowerCase() + value.slice(1)
}
