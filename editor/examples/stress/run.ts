import type {} from './src/browser.ts'
import type { Browser, Route, CDPSession } from '@playwright/test'
import { gzipSync } from 'node:zlib'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { cpus, platform, release, totalmem, arch } from 'node:os'
import { dirname, resolve, extname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { createManifest } from './fixtures.ts'
import { scenarios, states, validateResult } from './results.ts'
import { runScenario } from './scenarios.ts'
import { fail } from './errors.ts'
import { operationsPerSample, runInputSuite, type ClosedInputSample } from './input-scenarios.ts'
import { inputScenarios, inputViewModes, validateInputResult } from './input-results.ts'
import { profileScenario, profileSourceMaps } from './profile.ts'
import { hashBenchmarkSource, loadCorePackage } from './core-package.ts'

type Fixture = ReturnType<typeof createManifest>['fixtures'][number]
type Session = Awaited<ReturnType<typeof newPage>>
type Result = { samples: Awaited<ReturnType<typeof sample>>[] }

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '../..')
const { values } = parseArgs({
  options: {
    suite: { type: 'string', default: 'stress' },
    'input-smoke': { type: 'boolean', default: false },
    'slowdown-ms': { type: 'string', default: '0' },
    output: { type: 'string', default: '/work/tmp/editor-stress/result.json' },
    repetitions: { type: 'string', default: '3' },
    warmups: { type: 'string', default: '1' },
    seed: { type: 'string', default: '60061' },
    fixtures: { type: 'string', default: '' },
    diagnostics: { type: 'boolean', default: false },
    'verify-cancellation': { type: 'boolean', default: false },
    url: { type: 'string' },
    'profile-directory': { type: 'string' },
    'core-directory': { type: 'string' },
  },
})
const integer = (text: string, name: string) => {
  const value = Number(text)
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive integer`)
  return value
}
if (!['stress', 'input-latency'].includes(values.suite)) fail('Unknown suite')
if (values['core-directory'] && values.url)
  fail('--core-directory requires a runner build, not --url')
const core = await loadCorePackage(
  values['core-directory'] ?? resolve(repository, 'packages/editor'),
)
const inputSuite = values.suite === 'input-latency'
if (!inputSuite && (values['input-smoke'] || Number(values['slowdown-ms']) !== 0))
  fail('Input controls require --suite input-latency')
if (inputSuite && values.fixtures)
  fail('The input suite requires all three fixtures; use --input-smoke for development')
const baseConfig = {
  runnerVersion: 1,
  repetitions: integer(values.repetitions, 'repetitions'),
  warmups: integer(values.warmups, 'warmups'),
  scenarios,
  diagnostics: values.diagnostics,
  typedText: 'abcdefghijklmnopqrstuvwxyz0123456789abcd',
  churnCycles: 100,
  viewport: { width: 1000, height: 1000 },
  syntax: 'tree-sitter-typescript-on-ordinary-open-only',
  views: 'two-visible-one-hidden-on-churn',
  delivery: values.url ? 'existing-vite-server' : 'vite-production-playwright-route',
  paintMeasurement: 'screenshot-completion-upper-bound',
  memory: 'chromium-cdp-forced-gc',
}
const config: Omit<typeof baseConfig, 'views' | 'scenarios'> & {
  views: string | readonly string[]
  scenarios: readonly string[]
  slowdownMs?: number
  profiling?: { intervalMicros: number; minify: boolean; scenarios: string[] }
} = baseConfig
if (inputSuite) {
  Object.assign(config, {
    scenarios: inputScenarios,
    views: inputViewModes,
    operationsPerSample,
    slowdownMs: Number(values['slowdown-ms']),
    syntax: 'tree-sitter-typescript-on-ordinary',
    measurement: 'native-event-capture-through-handler-return-microtask-or-preedit-bubble',
    composition: 'chromium-cdp-imeSetComposition-and-insertText',
    compositionCommitTrust: 'cdp-untrusted-compositionend',
    isolation: 'closed-browser-context-per-fixture-view-scenario',
    paste: 'native-clipboard-shortcut-128-unicode-fragments',
  })
  if (
    typeof config.slowdownMs !== 'number' ||
    !Number.isFinite(config.slowdownMs) ||
    config.slowdownMs < 0
  )
    fail('Invalid slowdown')
  if (values['profile-directory']) fail('Use normal input runs for the input budget')
}
const manifest = createManifest(integer(values.seed, 'seed'))
if (inputSuite)
  manifest.fixtures = manifest.fixtures.filter((fixture) =>
    ['ordinary', 'short-lines', 'long-line'].includes(fixture.id),
  )
if (values['profile-directory']) {
  config.profiling = { intervalMicros: 1000, minify: false, scenarios: ['typing', 'churn'] }
  if (values.url) fail('CPU profiles require the built entry and its saved source maps')
}
if (values.fixtures) {
  const requested = values.fixtures.split(',')
  if (requested.some((id) => !manifest.fixtures.some((fixture) => fixture.id === id)))
    fail('Unknown fixture')
  manifest.fixtures = manifest.fixtures.filter((fixture) => requested.includes(fixture.id))
}
const temporaryRoot = '/work/tmp'
await mkdir(temporaryRoot, { recursive: true })
if (values['profile-directory']) {
  await mkdir(dirname(resolve(values['profile-directory'])), { recursive: true })
  await mkdir(resolve(values['profile-directory']))
}
const directory = await mkdtemp(resolve(temporaryRoot, 'editor-stress-'))
let browser: Browser | undefined
let partialOutput
let interrupted = false
const interrupt = () => {
  interrupted = true
  void browser?.close().catch(() => {})
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

try {
  if (!values.url)
    await build({
      root,
      configFile: false,
      logLevel: 'warn',
      resolve: { alias: core.aliases },
      plugins: values['profile-directory'] ? [profileSourceMaps()] : [],
      worker: { format: 'es' },
      build: {
        outDir: directory,
        emptyOutDir: true,
        minify: !values['profile-directory'],
        sourcemap: Boolean(values['profile-directory']),
      },
    })
  if (values['profile-directory'])
    await cp(directory, resolve(values['profile-directory'], 'build'), { recursive: true })
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: directory } })
  const stressSamples: Awaited<ReturnType<typeof sample>>[] = []
  const inputSamples: ClosedInputSample[] = []
  const samples = inputSuite ? inputSamples : stressSamples
  const result: {
    schemaVersion: number
    suite?: string
    id: string
    createdAt: string
    manifest: typeof manifest
    config: ReturnType<typeof reportConfig>
    environment: Awaited<ReturnType<typeof environment>>
    samples: typeof samples
    cancellation?: Awaited<ReturnType<typeof verifyCancellation>>
    smokeOnly?: boolean
  } = {
    schemaVersion: 1,
    ...(inputSuite ? { suite: 'input-latency' } : {}),
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    manifest,
    config: reportConfig(),
    environment: await environment(browser),
    samples,
  }
  if (values['verify-cancellation']) result.cancellation = await verifyCancellation(browser)
  if (inputSuite)
    await runInputSuite(
      browser,
      { ...result, samples: inputSamples },
      { newPage, readMemory, smoke: values['input-smoke'] },
    )
  else
    for (const fixture of manifest.fixtures)
      await runFixture(browser, fixture, { samples: stressSamples })
  if (values['input-smoke']) result.smokeOnly = true
  else if (inputSuite) validateInputResult(result)
  else validateResult({ ...result, samples: stressSamples, config })
  if (interrupted) fail('Run cancelled; incomplete results were not saved')
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  partialOutput = `${resolve(values.output)}.${result.id}.partial`
  const serialized = JSON.stringify(result) + '\n'
  await writeFile(partialOutput, values.output.endsWith('.gz') ? gzipSync(serialized) : serialized)
  if (interrupted) fail('Run cancelled before publishing results')
  await rename(partialOutput, values.output)
  console.log(
    JSON.stringify({
      event: inputSuite ? 'input.complete' : 'stress.complete',
      output: resolve(values.output),
      samples: result.samples.length,
    }),
  )
} finally {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  await browser?.close()
  if (partialOutput) await rm(partialOutput, { force: true })
  await rm(directory, { recursive: true, force: true })
}

async function newPage(browser: Browser) {
  const context = await browser.newContext({
    viewport: config.viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  if (!values.url) await context.route('**/*', (route: Route) => routeAsset(route))
  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) =>
    console.error(JSON.stringify({ event: 'stress.pageerror', message: error.message })),
  )
  await page.goto(values.url ?? 'http://localhost:4173/', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(globalThis.__stress))
  const cdp = await context.newCDPSession(page)
  return { page, context, cdp }
}

async function routeAsset(route: Route) {
  const url = new URL(route.request().url())
  const path = resolve(
    directory,
    '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
  )
  if (!path.startsWith(directory + sep)) return route.abort()
  const types: Record<string, string> = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
  }
  try {
    await route.fulfill({
      body: await readFile(path),
      contentType: types[extname(path)] ?? 'application/octet-stream',
    })
  } catch {
    await route.fulfill({ status: 404, body: `Missing benchmark asset: ${url.pathname}` })
  }
}

async function runFixture(browser: Browser, fixture: Fixture, result: Result) {
  for (const scenario of scenarios) {
    for (const state of states) await runGroup(browser, fixture, scenario, state, result)
  }
}

async function runGroup(
  browser: Browser,
  fixture: Fixture,
  scenario: string,
  state: string,
  result: Result,
) {
  let session = state === 'warm' ? await newPage(browser) : null
  try {
    if (session) await warmup(session, fixture, scenario)
    for (let repetition = 0; repetition < config.repetitions; repetition++) {
      session ??= await newPage(browser)
      result.samples.push(await sample(session, fixture, scenario, state, repetition))
      if (state === 'warm') continue
      await session.context.close()
      session = null
    }
  } finally {
    await session?.context.close()
  }
}

async function warmup(session: Session, fixture: Fixture, scenario: string) {
  for (let index = 0; index < config.warmups; index++)
    await sample(session, fixture, scenario, 'warm', -1)
}

async function sample(
  { page, cdp }: Session,
  fixture: Fixture,
  scenario: string,
  state: string,
  repetition: number,
) {
  const identity = { fixture: fixture.id, fixtureHash: fixture.sha256, scenario, state, repetition }
  const startedAt = Date.now()
  let completed
  let liveMemory
  let diagnostics: ReturnType<typeof __stress.observe>['diagnostics'] = []
  const before = await readMemory(cdp)
  try {
    const generated = await page.evaluate(
      ({ id, seed, diagnostics }) => __stress.prepare(id, seed, diagnostics),
      { id: fixture.id, seed: manifest.seed, diagnostics: config.diagnostics },
    )
    if (
      generated.sha256 !== fixture.sha256 ||
      generated.lines !== fixture.lines ||
      generated.bytes !== fixture.bytes
    )
      fail('Browser fixture differs from the checked manifest')
    const measure = <T>(run: () => Promise<T>) =>
      profileScenario({ cdp, directory: values['profile-directory'], identity, run })
    completed = await runScenario(page, scenario, config, fixture, measure)
    diagnostics = await page.evaluate(() => __stress.observe().diagnostics)
    if (!config.diagnostics && diagnostics.length)
      fail('Diagnostics were active on the disabled path')
    if (scenario === 'churn') liveMemory = await readMemory(cdp)
  } catch (error) {
    await page.screenshot({ path: '/work/tmp/editor-stress-failure.png' }).catch(() => {})
    const observed = await page.evaluate(() => __stress.observe()).catch(() => null)
    console.error(
      JSON.stringify({
        event: 'stress.scenario',
        ...identity,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
        observed,
        durationMs: Date.now() - startedAt,
      }),
    )
    throw error
  } finally {
    await page.evaluate(() => __stress.dispose())
  }
  const after = await readMemory(cdp)
  const cleanup = await page.evaluate(() => __stress.retention())
  const memory = {
    status: 'supported',
    method: 'CDP HeapProfiler.collectGarbage + Runtime.getHeapUsage + Memory.getDOMCounters',
    before,
    after,
    ...(liveMemory ? { postChurn: liveMemory } : {}),
  }
  console.log(
    JSON.stringify({
      event: 'stress.scenario',
      ...identity,
      status: 'passed',
      durationMs: Date.now() - startedAt,
      retainedObjects: cleanup.retainedObjects,
    }),
  )
  return { ...identity, ...completed, diagnostics, memory, cleanup, correct: true }
}

async function readMemory(cdp: CDPSession) {
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  const dom = await cdp.send('Memory.getDOMCounters')
  return { usedBytes: heap.usedSize, totalBytes: heap.totalSize, ...dom }
}

async function verifyCancellation(browser: Browser) {
  const { page, context, cdp } = await newPage(browser)
  try {
    await page.evaluate(async () => {
      await __stress.prepare('ordinary', 60061, false)
      __stress.open(true, false)
    })
    const running = page
      .evaluate(() => __stress.churn(100_000))
      .then(
        () => false,
        (error: { message: string | string[] }) => error.message.includes('Scenario cancelled'),
      )
    await page.evaluate(() => __stress.cancel())
    if (!(await running)) fail('Cancelled churn unexpectedly completed')
    await page.evaluate(() => __stress.dispose())
    await readMemory(cdp)
    const cleanup = await page.evaluate(() => __stress.retention())
    if (cleanup.active || cleanup.hosts || cleanup.pendingFrames || cleanup.retainedObjects)
      fail('Cancellation leaked scenario resources')
    return { passed: true, cleanup }
  } finally {
    await context.close()
  }
}

async function environment(browser: Browser) {
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
  const deletedFiles = new Set(
    git('ls-files', '--deleted', 'packages', 'examples/stress').split('\n'),
  )
  const files = git(
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    'packages',
    'examples/stress',
  )
    .split('\n')
    .filter((file) => file && !deletedFiles.has(file))
  return {
    commit: git('rev-parse', 'HEAD'),
    dirty: Boolean(git('status', '--porcelain')),
    sourceHash: await hashBenchmarkSource(repository, files, core.sourceDirectory),
    coreDirectory: core.directory,
    browser: { engine: 'chromium', version: browser.version(), headless: true },
    hardware: {
      cpu: cpus()[0]?.model ?? 'unknown',
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      architecture: arch(),
      platform: platform(),
      release: release(),
    },
    runtime: process.version,
    unsupportedMemory: {
      processRss: 'No portable renderer process RSS API; CDP reports heap and DOM counts.',
      userAgentSpecificMemory: 'Cross-origin isolation is not required by this runner.',
    },
  }
}

function reportConfig() {
  if (!inputSuite) return config
  const { typedText: _typedText, churnCycles: _churnCycles, ...inputConfig } = config
  return inputConfig
}
