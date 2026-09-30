import * as bench from './bench-workspace.ts'
import type { EditorPerformanceTraceReport } from '../src/features/editor/state/performance-trace.ts'
import type { Browser, Page } from 'playwright'
import { createBenchmarkError } from './structured-errors.ts'
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
await bench.runBenchmark(
  'EDITOR_SCROLL_BENCHMARK',
  options,
  gateThresholds,
  runBrowserSamples,
  thresholdFailures,
)
function parseOptions(args: readonly string[]) {
  const parsed = {
    ...bench.benchmarkOptions('EDITOR_SCROLL_BENCH'),
    stepPx: bench.numberOption(process.env.EDITOR_SCROLL_BENCH_STEP_PX, 36),
    steps: bench.numberOption(process.env.EDITOR_SCROLL_BENCH_STEPS, 80),
  }
  return bench.parseBenchmarkOptions(parsed, args, (parsed, name, value) => {
    if (name === '--step-px') parsed.stepPx = bench.numberOption(value, parsed.stepPx)
    if (name === '--steps') parsed.steps = bench.numberOption(value, parsed.steps)
  })
}
async function runBrowserSamples(
  browserName: bench.BrowserName,
  workspace: bench.BenchmarkWorkspace,
) {
  const samples = await bench.browserSamples(
    'editor-scroll-benchmark-trial',
    browserName,
    workspace,
    options.trials,
    runTrialInBrowser,
  )
  return summarizeSamples(samples)
}
async function runTrialInBrowser(
  browser: Browser,
  browserName: bench.BrowserName,
  trial: number,
  workspace: bench.BenchmarkWorkspace,
) {
  const page = await bench.benchmarkPage(browser, workspace, options)
  await bench.applyCpuThrottle(page, browserName, options.cpuThrottle)
  const cpuCalibrationMs = await bench.measureCpuCalibration(page)
  const report = await runScrollSample(page)
  return trialSample(browserName, trial, report, cpuCalibrationMs)
}
async function runScrollSample(page: Page) {
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
  if ('error' in report) throw createBenchmarkError(report.error)
  return report
}
function trialSample(
  browserName: bench.BrowserName,
  trial: number,
  report: EditorPerformanceTraceReport,
  cpuCalibrationMs: number,
) {
  const ranges = bench.diagnostic(report, 'editor.tokenHighlights.ranges')
  const segments = bench.diagnostic(report, 'editor.tokenHighlights.segments')
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
function summarizeSamples(samples: readonly Awaited<ReturnType<typeof runTrialInBrowser>>[]) {
  return {
    trials: samples.length,
    bestFrameMeanMs: bench.minimum(samples.map((sample) => sample.frameMeanMs)),
    cssHighlightRanges: samples.at(-1)?.cssHighlightRanges ?? 0,
    meanCpuCalibrationMs: bench.average(samples.map((sample) => sample.cpuCalibrationMs)),
    editorRows: samples.at(-1)?.editorRows ?? 0,
    meanFrameMaxMs: bench.average(samples.map((sample) => sample.frameMaxMs)),
    meanFrameMeanMs: bench.average(samples.map((sample) => sample.frameMeanMs)),
    meanLongFrames: bench.average(samples.map((sample) => sample.longFrames)),
    meanRangesCount: bench.average(samples.map((sample) => sample.rangesCount)),
    meanRangesTotalMs: bench.average(samples.map((sample) => sample.rangesTotalMs)),
    meanSegmentsCount: bench.average(samples.map((sample) => sample.segmentsCount)),
    meanSegmentsTotalMs: bench.average(samples.map((sample) => sample.segmentsTotalMs)),
    meanSlowFrames: bench.average(samples.map((sample) => sample.slowFrames)),
    medianFrameMeanMs: bench.median(samples.map((sample) => sample.frameMeanMs)),
    samples,
  }
}
function thresholdFailures(
  browserName: bench.BrowserName,
  summary: ReturnType<typeof summarizeSamples>,
  thresholds: Readonly<Record<string, number>>,
) {
  return Object.entries(thresholds).flatMap(([key, threshold]) => {
    const metric = metricForThreshold(summary, key)
    if (metric <= threshold) return []
    return [{ browserName, key, metric, threshold }]
  })
}
function metricForThreshold(summary: ReturnType<typeof summarizeSamples>, key: string) {
  const metricName = key.replace(/^max/, '')
  const value: unknown = Reflect.get(summary, lowercaseFirst(metricName))
  return typeof value === 'number' ? value : Number.POSITIVE_INFINITY
}
function lowercaseFirst(value: string) {
  return value.charAt(0).toLowerCase() + value.slice(1)
}
