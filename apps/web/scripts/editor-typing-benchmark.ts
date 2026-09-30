import * as bench from './bench-workspace.ts'
import { roundMs } from '@workspace/utils/timing'
import type { EditorPerformanceTraceReport } from '../src/features/editor/state/performance-trace.ts'
import type { Browser, Page } from 'playwright'
import { createBenchmarkError } from './structured-errors.ts'
const typedText = 'abcdefghijklmnopqrstuvwxyz0123456789abcd'
const options = parseOptions(process.argv.slice(2))
// Keystroke latency: keydown event timestamp to the first animation frame
// that runs after the editor applied the edit. Steady approximates human
// typing; burst removes inter-key delay so queueing and per-edit cost
// dominate. The clock still includes browser frame scheduling.
const gateThresholds = {
  chromium: {
    maxSteadyP95Ms: 30,
    maxBurstP95Ms: 30,
    maxApplyEditMeanMs: 3,
  },
  firefox: {
    maxSteadyP95Ms: 20,
    // Firefox queues key events under burst input, and the Gecko highlight
    // repaint nudge (full registry re-register per keystroke, required for
    // correct ::highlight() paint over recycled rows) adds ~10-20ms at burst
    // p95. Clean-machine baseline p95 31-51ms.
    maxBurstP95Ms: 60,
    maxApplyEditMeanMs: 6,
  },
  webkit: {
    maxSteadyP95Ms: 25,
    maxBurstP95Ms: 25,
    maxApplyEditMeanMs: 6,
  },
}
await bench.runBenchmark(
  'EDITOR_TYPING_BENCHMARK',
  options,
  gateThresholds,
  runBrowserSamples,
  thresholdFailures,
)
function parseOptions(args: readonly string[]) {
  const parsed = {
    ...bench.benchmarkOptions('EDITOR_TYPING_BENCH'),
    keyDelayMs: bench.numberOption(process.env.EDITOR_TYPING_BENCH_KEY_DELAY_MS, 40),
  }
  return bench.parseBenchmarkOptions(parsed, args, (parsed, name, value) => {
    if (name === '--key-delay-ms') parsed.keyDelayMs = bench.numberOption(value, parsed.keyDelayMs)
  })
}
async function runBrowserSamples(
  browserName: bench.BrowserName,
  workspace: bench.BenchmarkWorkspace,
) {
  const samples = await bench.browserSamples(
    'editor-typing-benchmark-trial',
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
  await placeCaret(page)
  await installCollector(page)
  await bench.applyCpuThrottle(page, browserName, options.cpuThrottle)
  const cpuCalibrationMs = await bench.measureCpuCalibration(page)
  const steady = await runScenario(page, 'steady', options.keyDelayMs)
  const burst = await runScenario(page, 'burst', 0)
  return {
    browserName,
    trial,
    cpuCalibrationMs,
    steady,
    burst,
  }
}
async function placeCaret(page: Page) {
  const row = page.locator('.editor-virtualized-row').nth(20)
  await row.click({ position: { x: 40, y: 8 } })
  await page.keyboard.press('End')
}
async function installCollector(page: Page) {
  await page.evaluate(() => {
    const keydowns: number[] = []
    const frames: number[] = []
    let raf = 0
    const tick = () => {
      frames.push(performance.now())
      raf = requestAnimationFrame(tick)
    }
    window.__typingBench = {
      start() {
        keydowns.length = 0
        frames.length = 0
        cancelAnimationFrame(raf)
        raf = requestAnimationFrame(tick)
      },
      stop() {
        cancelAnimationFrame(raf)
      },
      data() {
        return { frames: [...frames], keydowns: [...keydowns] }
      },
    }
    window.addEventListener(
      'keydown',
      (event) => {
        keydowns.push(event.timeStamp)
      },
      { capture: true },
    )
  })
}
async function runScenario(page: Page, scenario: string, keyDelayMs: number) {
  await page.evaluate(() => {
    window.__editorPerfTrace.reset()
    window.__typingBench.start()
  })
  await page.keyboard.type(typedText, { delay: keyDelayMs })
  await page.waitForTimeout(300)
  const raw = await page.evaluate(() => {
    window.__typingBench.stop()
    return {
      collected: window.__typingBench.data(),
      report: window.__editorPerfTrace.report(),
    }
  })
  return scenarioSample(scenario, raw)
}
function scenarioSample(
  scenario: string,
  raw: {
    collected: ReturnType<Window['__typingBench']['data']>
    report: EditorPerformanceTraceReport
  },
) {
  const latencies = keystrokeLatencies(raw.collected)
  const applyEdit = bench.diagnostic(raw.report, 'editor.view.applyEdit')
  const render = bench.diagnostic(raw.report, 'editor.renderSessionChange')
  if (applyEdit.count < typedText.length) {
    throw createBenchmarkError(
      `Editor applied ${applyEdit.count}/${typedText.length} edits in ${scenario}; input focus was lost.`,
    )
  }
  return {
    scenario,
    keystrokes: latencies.length,
    latencyP50Ms: bench.percentile(latencies, 0.5),
    latencyP95Ms: bench.percentile(latencies, 0.95),
    latencyMaxMs: bench.maximum(latencies),
    slowKeystrokes: latencies.filter((latency) => latency > 16.7).length,
    longKeystrokes: latencies.filter((latency) => latency > 50).length,
    applyEditCount: applyEdit.count,
    applyEditMeanMs: applyEdit.meanMs,
    applyEditMaxMs: applyEdit.maxMs,
    renderMeanMs: render.meanMs,
    renderMaxMs: render.maxMs,
  }
}
function keystrokeLatencies(collected: ReturnType<Window['__typingBench']['data']>) {
  const latencies = []
  let frameIndex = 0
  for (const keydown of collected.keydowns) {
    while (frameIndex < collected.frames.length && collected.frames[frameIndex] <= keydown) {
      frameIndex += 1
    }
    if (frameIndex >= collected.frames.length) break
    latencies.push(roundMs(collected.frames[frameIndex] - keydown))
  }
  return latencies
}
function summarizeSamples(samples: readonly Awaited<ReturnType<typeof runTrialInBrowser>>[]) {
  return {
    trials: samples.length,
    meanCpuCalibrationMs: bench.average(samples.map((sample) => sample.cpuCalibrationMs)),
    steady: scenarioSummary(samples.map((sample) => sample.steady)),
    burst: scenarioSummary(samples.map((sample) => sample.burst)),
    samples,
  }
}
function scenarioSummary(scenarios: readonly ReturnType<typeof scenarioSample>[]) {
  return {
    meanP50Ms: bench.average(scenarios.map((scenario) => scenario.latencyP50Ms)),
    meanP95Ms: bench.average(scenarios.map((scenario) => scenario.latencyP95Ms)),
    maxP95Ms: bench.maximum(scenarios.map((scenario) => scenario.latencyP95Ms)),
    maxLatencyMs: bench.maximum(scenarios.map((scenario) => scenario.latencyMaxMs)),
    meanSlowKeystrokes: bench.average(scenarios.map((scenario) => scenario.slowKeystrokes)),
    meanLongKeystrokes: bench.average(scenarios.map((scenario) => scenario.longKeystrokes)),
    meanApplyEditMeanMs: bench.average(scenarios.map((scenario) => scenario.applyEditMeanMs)),
    maxApplyEditMaxMs: bench.maximum(scenarios.map((scenario) => scenario.applyEditMaxMs)),
  }
}
function thresholdFailures(
  browserName: bench.BrowserName,
  summary: ReturnType<typeof summarizeSamples>,
  thresholds: Readonly<Record<string, number>>,
) {
  const metrics: Readonly<Record<string, number>> = {
    maxApplyEditMeanMs: Math.max(
      summary.steady.meanApplyEditMeanMs,
      summary.burst.meanApplyEditMeanMs,
    ),
    maxBurstP95Ms: summary.burst.maxP95Ms,
    maxSteadyP95Ms: summary.steady.maxP95Ms,
  }
  return Object.entries(thresholds).flatMap(([key, threshold]) => {
    const metric = metrics[key] ?? Number.POSITIVE_INFINITY
    if (metric <= threshold) return []
    return [{ browserName, key, metric, threshold }]
  })
}
