import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { hashBenchmarkSource, loadCorePackage } from './core-package.mjs'
import { fail } from './errors.mjs'
import { createManifest } from './fixtures.mjs'
import { createTraceLocation, summarizeLayoutTrace } from './input-layout-summary.mjs'
import { inputScenarios, inputViewModes } from './input-results.mjs'
import { operationsPerSample, runSample } from './input-scenarios.mjs'
import { profileSourceMaps } from './profile.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '../..')
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    groups: {
      type: 'string',
      default:
        'ordinary/multiple/typing,long-line/multiple/typing,long-line/multiple/paste,short-lines/multiple/paste',
    },
    mode: { type: 'string', default: 'trace' },
    repetitions: { type: 'string', default: '3' },
    warmups: { type: 'string', default: '1' },
    seed: { type: 'string', default: '60061' },
    'core-directory': { type: 'string' },
  },
})
if (!values.output) fail('--output must name a new profiling directory')
if (!['timing', 'trace'].includes(values.mode)) fail('--mode must be timing or trace')
const directory = resolve(values.output)
const buildDirectory = resolve(directory, 'build')
const temporaryDirectory = resolve(directory, 'browser')
const tracing = values.mode === 'trace'
const core = await loadCorePackage(
  values['core-directory'] ?? resolve(repository, 'packages/editor'),
)
const manifest = createManifest(integer(values.seed, 'seed'))
manifest.fixtures = manifest.fixtures.filter((fixture) =>
  ['ordinary', 'short-lines', 'long-line'].includes(fixture.id),
)
const groups = values.groups.split(',').map(parseGroup)
if (new Set(values.groups.split(',')).size !== groups.length) fail('Duplicate profiling group')
const config = {
  runnerVersion: 1,
  repetitions: integer(values.repetitions, 'repetitions'),
  warmups: integer(values.warmups, 'warmups'),
  scenarios: inputScenarios,
  views: inputViewModes,
  groups: values.groups.split(','),
  diagnostics: false,
  slowdownMs: 0,
  operationsPerSample,
  viewport: { width: 1000, height: 1000 },
  syntax: 'tree-sitter-typescript-on-ordinary',
  delivery: 'vite-production-playwright-route',
  paintMeasurement: 'screenshot-completion-upper-bound',
  memory: 'chromium-cdp-forced-gc',
  measurement: 'native-event-capture-through-handler-return-microtask-or-preedit-bubble',
  composition: 'chromium-cdp-imeSetComposition-and-insertText',
  compositionCommitTrust: 'cdp-untrusted-compositionend',
  isolation: 'closed-browser-context-per-fixture-view-scenario',
  paste: 'native-clipboard-shortcut-128-unicode-fragments',
  profiling: tracing
    ? {
        mode: 'trace',
        intervalMicros: 100,
        minify: false,
        window: 'native-sendInput-burst-between-Performance-metric-timestamps',
        layoutAttribution: 'first-direct-Layout-stack-frame-or-unattributed',
        timingComparable: false,
      }
    : { mode: 'timing', minify: true, instrumented: false },
}
await mkdir(dirname(directory), { recursive: true })
await mkdir(directory)
await mkdir(temporaryDirectory)
const result = {
  schemaVersion: 1,
  suite: tracing ? 'input-layout-profile' : 'input-latency-focused',
  id: randomUUID(),
  createdAt: new Date().toISOString(),
  complete: false,
  budgetEligible: false,
  manifest,
  config,
  samples: [],
  profiles: [],
}
const location = createTraceLocation(buildDirectory)
let browser
try {
  result.environment = await environment()
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: core.aliases },
    plugins: tracing ? [profileSourceMaps()] : [],
    worker: { format: 'es' },
    build: { outDir: buildDirectory, emptyOutDir: true, minify: !tracing, sourcemap: tracing },
  })
  browser = await chromium.launch({
    headless: true,
    env: { ...process.env, TMPDIR: temporaryDirectory },
  })
  result.environment.browser = { engine: 'chromium', version: browser.version(), headless: true }
  for (const group of groups) await runGroup(group)
  if (result.environment.sourceHash !== (await environment()).sourceHash)
    fail('Benchmark source changed during the run')
  result.complete = true
  await saveResult()
  await rename(resolve(directory, 'result.partial.json'), resolve(directory, 'result.json'))
  console.log(
    JSON.stringify({
      event: 'input.layout.complete',
      mode: values.mode,
      output: directory,
      samples: result.samples.length,
    }),
  )
} catch (error) {
  result.failure = error.message
  await saveResult()
  throw error
} finally {
  await browser?.close()
  await rm(temporaryDirectory, { recursive: true, force: true })
}

function integer(text, name) {
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive integer`)
  return value
}

function parseGroup(group) {
  const [id, views, scenario, extra] = group.split('/')
  const fixture = manifest.fixtures.find((entry) => entry.id === id)
  if (
    !fixture ||
    !inputViewModes.includes(views) ||
    !inputScenarios.includes(scenario) ||
    extra !== undefined
  )
    fail(`Unknown profiling group: ${group}`)
  return { fixture, views, scenario }
}

async function runGroup({ fixture, views, scenario }) {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  const samples = []
  const errors = []
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await context.route('**/*', routeAsset)
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
    await page.waitForFunction(() => Boolean(globalThis.__stress))
    const cdp = await context.newCDPSession(page)
    await runRepetitions({ page, cdp }, { fixture, views, scenario }, samples)
    if (errors.length) fail(`Browser errors: ${errors.join('; ')}`)
  } finally {
    await context.close()
  }
  for (const sample of samples)
    result.samples.push({ ...sample, cleanup: { ...sample.cleanup, contextClosed: true } })
  await saveResult()
}

async function runRepetitions(session, { fixture, views, scenario }, samples) {
  for (let repetition = -config.warmups; repetition < config.repetitions; repetition++) {
    const sample = await runSample(
      session,
      fixture,
      views,
      scenario,
      repetition,
      result,
      readMemory,
      tracing ? profileInput : undefined,
    )
    if (repetition < 0) continue
    samples.push(sample)
    console.log(
      JSON.stringify({
        event: 'input.layout.sample',
        mode: values.mode,
        fixture: fixture.id,
        views,
        scenario,
        repetition,
        correct: sample.correct,
      }),
    )
  }
}

async function profileInput({ cdp, fixture, views, scenario, repetition }, run) {
  if (repetition < 0) return run()
  const name = `${fixture}-${views}-${scenario}-${repetition}`
  const traceEvents = []
  const collect = ({ value }) => traceEvents.push(...value)
  await cdp.send('Performance.enable')
  await cdp.send('Debugger.enable')
  await cdp.send('Profiler.enable')
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
  cdp.on('Tracing.dataCollected', collect)
  await cdp.send('Tracing.start', {
    traceConfig: {
      recordMode: 'recordUntilFull',
      includedCategories: [
        'devtools.timeline',
        'blink.user_timing',
        'disabled-by-default-devtools.timeline.stack',
        'disabled-by-default-devtools.timeline.invalidationTracking',
      ],
    },
  })
  await cdp.send('Profiler.start')
  const before = await readMetrics(cdp)
  try {
    return await run()
  } finally {
    const after = await readMetrics(cdp)
    const { profile } = await cdp.send('Profiler.stop')
    const complete = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve))
    await cdp.send('Tracing.end')
    const status = await complete
    cdp.off('Tracing.dataCollected', collect)
    await cdp.send('Profiler.disable')
    await cdp.send('Debugger.disable')
    await cdp.send('Performance.disable')
    await writeFile(
      resolve(directory, `${name}.trace.json`),
      JSON.stringify({ traceEvents }) + '\n',
    )
    await writeFile(resolve(directory, `${name}.cpuprofile`), JSON.stringify(profile) + '\n')
    if (status.dataLossOccurred) fail('Trace buffer lost events')
    const window = { startMicros: before.Timestamp * 1e6, endMicros: after.Timestamp * 1e6 }
    const metrics = Object.fromEntries(
      Object.entries(after).map(([key, value]) => [key, value - before[key]]),
    )
    const layouts = await summarizeLayoutTrace(traceEvents, window, location)
    const record = {
      name,
      window,
      metrics,
      layouts,
      traceLayoutCountMatchesMetric: layouts.count === metrics.LayoutCount,
    }
    result.profiles.push(record)
    console.log(JSON.stringify({ event: 'input.layout.profile', ...record }))
  }
}

async function readMetrics(cdp) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(metrics.map(({ name, value }) => [name, value]))
}

async function readMemory(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  return { usedBytes: heap.usedSize, totalBytes: heap.totalSize, ...dom }
}

async function routeAsset(route) {
  const pathname = new URL(route.request().url()).pathname
  const file = resolve(
    buildDirectory,
    '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)),
  )
  if (!file.startsWith(buildDirectory + sep)) return route.abort()
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
  }
  try {
    await route.fulfill({
      body: await readFile(file),
      contentType: types[extname(file)] ?? 'application/octet-stream',
    })
  } catch {
    await route.fulfill({ status: 404, body: `Missing benchmark asset: ${pathname}` })
  }
}

async function environment() {
  const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
  const files = git(
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'packages',
    'examples/stress',
  ).split('\n')
  return {
    repository,
    commit: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain')),
    sourceHash: await hashBenchmarkSource(repository, files, core.sourceDirectory),
    coreDirectory: core.directory,
    runtime: process.version,
    hardware: {
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      architecture: arch(),
      platform: platform(),
      release: release(),
    },
  }
}

async function saveResult() {
  await writeFile(resolve(directory, 'result.partial.json'), JSON.stringify(result, null, 2) + '\n')
}
