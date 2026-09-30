import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, expect } from '@playwright/test'
import { build } from 'vite'
import { loadCorePackage, hashBenchmarkSource } from './core-package.mjs'
import { createManifest } from './fixtures.mjs'
import { fail } from './errors.mjs'
import { paintEvidence } from './scenarios.mjs'
import { generateFallbackFixture } from './src/fallbackFixture.ts'
import { fixtureFacts } from './src/fixtures.ts'

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '../..')
const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/work/tmp/editor-e003/result.json' },
    'core-directory': { type: 'string', default: resolve(repository, 'packages/editor') },
    repetitions: { type: 'string', default: '3' },
    fixtures: { type: 'string', default: 'ordinary,short-lines' },
    plugins: { type: 'string', default: 'none,tree-sitter' },
    modes: { type: 'string', default: 'direct,prepared' },
    diagnostics: { type: 'boolean', default: false },
    'fallback-cases': { type: 'boolean', default: false },
    'fold-gutter': { type: 'boolean', default: false },
  },
})
const repetitions = Number(values.repetitions)
if (!Number.isSafeInteger(repetitions) || repetitions < 1) fail('Invalid repetitions')
const select = (text, allowed) => {
  const result = text.split(',')
  if (new Set(result).size !== result.length || result.some((value) => !allowed.includes(value)))
    fail(`Expected a unique subset of ${allowed.join(',')}`)
  return result
}
const fixtures = select(values.fixtures, ['ordinary', 'short-lines'])
const plugins = select(values.plugins, ['none', 'tree-sitter'])
const modes = select(values.modes, ['direct', 'prepared'])
if (values['fallback-cases'] && plugins.some((plugin) => plugin !== 'none'))
  fail('Fallback cases require --plugins none')
const core = await loadCorePackage(values['core-directory'])
const manifest = createManifest(60061)
manifest.fixtures = manifest.fixtures.filter((fixture) => fixtures.includes(fixture.id))
if (values['fallback-cases']) {
  manifest.fallbackGeneratorVersion = 1
  manifest.fixtures = manifest.fixtures.map(({ id }) => {
    const text = generateFallbackFixture(id, manifest.seed)
    return { id, ...fixtureFacts(text), sha256: createHash('sha256').update(text).digest('hex') }
  })
}
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
const files = git(
  'ls-files',
  '--cached',
  '--others',
  '--exclude-standard',
  'packages',
  'examples/stress',
).split('\n')
const sourceHash = await hashBenchmarkSource(repository, files, core.sourceDirectory)
await mkdir('/work/tmp', { recursive: true })
const temporaryDirectory = await mkdtemp('/work/tmp/editor-first-paint-')
const directory = resolve(temporaryDirectory, 'build')
const browserDirectory = resolve(temporaryDirectory, 'browser')
let browser
let partialOutput
let interrupted = false
const interrupt = () => {
  interrupted = true
  void browser?.close().catch(() => {})
}
process.on('SIGINT', interrupt)
process.on('SIGTERM', interrupt)

try {
  await mkdir(browserDirectory)
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: core.aliases },
    worker: { format: 'es' },
    build: {
      outDir: directory,
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'first-paint.html') },
    },
  })
  browser = await chromium.launch({
    headless: true,
    env: { ...process.env, TMPDIR: browserDirectory },
  })
  const result = {
    schemaVersion: 1,
    suite: 'first-paint',
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    manifest,
    config: {
      repetitions,
      warmups: 1,
      modes,
      plugins,
      states: ['cold', 'warm'],
      diagnostics: values.diagnostics,
      fallbackCases: values['fallback-cases'],
      foldGutter: values['fold-gutter'],
      fallbackInput: 'beforeinput-to-onChange-and-requestAnimationFrame',
      viewport: { width: 1000, height: 1000 },
      delivery: 'vite-production-playwright-route',
      textMeasurement: 'screenshot-completion-upper-bound',
      callbackMeasurement: 'public-onInitialPaint-observable-not-pixels',
      preparation: 'exact-buffer-revision-and-provider-initial-4096-characters',
      fallbackPreparation: 'await-ready-prepared-metadata',
      cleanup: 'worker-idle-fence-then-main-renderer-forced-gc',
      tabSize: 4,
      cold: 'fresh-browser-context',
      warm: 'fresh-document-after-one-unrecorded-open-in-same-context',
    },
    environment: {
      commit: git('rev-parse', 'HEAD'),
      sourceHash,
      bundleHash: await hashDirectory(directory),
      coreBuildHash: await hashDirectory(resolve(core.directory, 'dist')),
      coreDirectory: core.directory,
      browser: browser.version(),
      runtime: process.version,
      cpuAffinity: await cpuAffinity(),
      hardware: {
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        arch: arch(),
        platform: platform(),
        release: release(),
      },
    },
    samples: [],
  }
  for (const fixture of manifest.fixtures) await runFixture(fixture, result)
  const expected = fixtures.length * plugins.length * modes.length * 2 * repetitions
  if (result.samples.length !== expected) fail('Missing first-paint samples')
  if (sourceHash !== (await hashBenchmarkSource(repository, files, core.sourceDirectory)))
    fail('Measured sources changed during the run')
  if (interrupted) fail('Run interrupted')
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  partialOutput = `${resolve(values.output)}.${result.id}.partial`
  await writeFile(partialOutput, JSON.stringify(result) + '\n')
  await rename(partialOutput, resolve(values.output))
  console.log(
    JSON.stringify({
      event: 'first-paint.complete',
      output: resolve(values.output),
      samples: result.samples.length,
    }),
  )
} finally {
  process.removeListener('SIGINT', interrupt)
  process.removeListener('SIGTERM', interrupt)
  await browser?.close()
  if (partialOutput) await rm(partialOutput, { force: true })
  await rm(temporaryDirectory, { recursive: true, force: true })
}

async function routeAsset(route) {
  const url = new URL(route.request().url())
  const path = resolve(directory, '.' + decodeURIComponent(url.pathname))
  if (!path.startsWith(directory + sep)) return route.abort()
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.wasm': 'application/wasm',
  }
  try {
    await route.fulfill({
      body: await readFile(path),
      contentType: types[extname(path)] ?? 'application/octet-stream',
    })
  } catch {
    await route.fulfill({ status: 404, body: url.pathname })
  }
}

async function cpuAffinity() {
  if (platform() !== 'linux') return null
  const status = await readFile('/proc/self/status', 'utf8')
  return status.match(/^Cpus_allowed_list:\s*(.+)$/m)?.[1] ?? null
}

async function hashDirectory(directory) {
  const hash = createHash('sha256')
  const entries = await readdir(directory, { recursive: true, withFileTypes: true })
  const files = entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name).slice(directory.length + 1))
    .sort()
  for (const file of files) hash.update(file).update(await readFile(resolve(directory, file)))
  return hash.digest('hex')
}

async function runFixture(fixture, result) {
  for (const plugin of plugins) await runPlugin(fixture, plugin, result)
}

async function runPlugin(fixture, plugin, result) {
  for (const mode of modes) await runMode({ fixture, plugin, mode }, result)
}

async function runMode(identity, result) {
  for (const state of result.config.states) await runGroup({ ...identity, state }, result)
}

async function newSession(config) {
  const context = await browser.newContext({
    viewport: config.viewport,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    colorScheme: 'light',
  })
  await context.route('**/*', routeAsset)
  const page = await context.newPage()
  page.setDefaultTimeout(120_000)
  const session = {
    context,
    page,
    cdp: await context.newCDPSession(page),
    assets: [],
    errors: [],
    messages: [],
    at: Date.now(),
  }
  context.on('request', (request) =>
    session.assets.push({
      phase: 'request',
      path: new URL(request.url()).pathname,
      wallTimeMs: Date.now() - session.at,
    }),
  )
  context.on('response', (response) =>
    session.assets.push({
      phase: 'response',
      path: new URL(response.url()).pathname,
      status: response.status(),
      wallTimeMs: Date.now() - session.at,
    }),
  )
  page.on('pageerror', (error) => session.errors.push(error.message))
  page.on('console', (message) => {
    if (session.messages.length < 256)
      session.messages.push({
        type: message.type(),
        text: message.text(),
        wallTimeMs: Date.now() - session.at,
      })
  })
  await page.goto('http://localhost:4173/first-paint.html', { waitUntil: 'networkidle' })
  await page.waitForFunction(() => Boolean(globalThis.__firstPaint))
  return session
}

async function runGroup(identity, result) {
  let session = null
  try {
    if (identity.state === 'warm') {
      session = await newSession(result.config)
      await sample(session, { ...identity, repetition: -1 }, result)
    }
    for (let repetition = 0; repetition < repetitions; repetition++) {
      session ??= await newSession(result.config)
      result.samples.push(await sample(session, { ...identity, repetition }, result))
      if (identity.state === 'warm') continue
      await session.context.close()
      session = null
    }
  } finally {
    await session?.context.close()
  }
}

async function sample(session, identity, result) {
  const { page, cdp } = session
  session.at = Date.now()
  session.assets = []
  session.messages = []
  session.errors = []
  try {
    const facts = await page.evaluate((configuration) => __firstPaint.configure(configuration), {
      fixture: identity.fixture.id,
      seed: manifest.seed,
      prepared: identity.mode === 'prepared',
      plugin: identity.plugin === 'tree-sitter',
      diagnostics: result.config.diagnostics,
      fallbackCases: result.config.fallbackCases,
      foldGutter: result.config.foldGutter,
    })
    if (facts.sha256 !== identity.fixture.sha256) fail('Fixture hash mismatch')
    const timing = await page.evaluate(() => __firstPaint.open())
    const text = await captureText(page)
    let highlighted = null
    if (identity.plugin === 'tree-sitter') {
      await page.waitForFunction(() => __firstPaint.status().initialHighlightStatus === 'painted')
      highlighted = await paintEvidence(
        page,
        page.locator('#view-0 [data-editor-virtual-row="0"]'),
        true,
      )
    }
    if (
      result.config.diagnostics &&
      !result.config.fallbackCases &&
      identity.mode === 'direct' &&
      identity.plugin === 'none'
    )
      await page.waitForFunction(
        (at) => __firstPaint.fallbackObservedAfter(at),
        timing.constructedAt,
      )
    const fallback = result.config.fallbackCases
      ? await fallbackCases(session, identity, result)
      : null
    const observation = await page.evaluate(() => __firstPaint.observe())
    validateObservation(observation, identity)
    if (session.errors.length) fail(`Browser errors: ${session.errors.join('; ')}`)
    await page.evaluate(() => __firstPaint.dispose())
    await cdp.send('HeapProfiler.collectGarbage')
    const beforeDisposalFence = await page.evaluate(() => __firstPaint.retention())
    await page.evaluate(() => __firstPaint.settleDisposal())
    await cdp.send('HeapProfiler.collectGarbage')
    const cleanup = await page.evaluate(() => __firstPaint.retention())
    if (cleanup.active || cleanup.hosts || cleanup.retainedObjects)
      fail('First-paint sample retained a document or view')
    const textEvent = observation.paints.find(
      (event) => event.phase === 'text' && event.documentId === identity.fixture.id,
    )
    const highlightEvent = observation.paints.find(
      (event) => event.phase === 'highlight-settled' && event.documentId === identity.fixture.id,
    )
    const latencyMs = {
      buffer: timing.bufferMs,
      preparation: timing.preparationMs,
      constructor: timing.constructedAt - timing.constructorAt,
      attach: timing.attachedAt - timing.constructedAt,
      openSynchronous: timing.attachedAt - timing.start,
      textCallback: textEvent.at - timing.start,
      visibleTextUpperBound: text.completedAt - timing.start,
      ...(highlighted
        ? {
            highlightCallback: highlightEvent.at - timing.start,
            highlightedPaintUpperBound: highlighted.completedAt - timing.start,
          }
        : {}),
    }
    if (Object.values(latencyMs).some((value) => !Number.isFinite(value) || value < 0))
      fail('Invalid first-paint latency')
    console.log(
      JSON.stringify({
        event: 'first-paint.sample',
        fixture: identity.fixture.id,
        mode: identity.mode,
        plugin: identity.plugin,
        state: identity.state,
        repetition: identity.repetition,
        latencyMs,
      }),
    )
    return {
      ...identity,
      fixture: identity.fixture.id,
      fixtureHash: facts.sha256,
      timing,
      latencyMs,
      observation,
      fallback,
      pixels: { text: text.pixels, highlighted: highlighted?.pixels ?? null },
      assets: session.assets,
      logs: session.messages,
      beforeDisposalFence,
      cleanup,
      correct: true,
    }
  } catch (error) {
    console.error(
      JSON.stringify({
        event: 'first-paint.failed',
        ...identity,
        fixture: identity.fixture.id,
        message: error.message,
        errors: session.errors,
        logs: session.messages,
        cleanup: await page.evaluate(() => __firstPaint.retention()).catch(() => null),
      }),
    )
    throw error
  } finally {
    await page.evaluate(() => __firstPaint.dispose()).catch(() => {})
  }
}

async function captureText(page) {
  const row = page.locator('#view-0 [data-editor-virtual-row="0"]')
  await expect(row).toBeVisible()
  await expect(row).toBeInViewport()
  await expect(row).toContainText('const needle0 = ')
  return paintEvidence(page, row)
}

function validateObservation(observation, identity) {
  const expectedRevision = values['fallback-cases'] ? 36 : 0
  if (!observation.correctText || observation.revision !== expectedRevision)
    fail('Opened document differs from its fixture')
  if (
    !observation.paints.some(
      (event) => event.phase === 'text' && event.documentId === identity.fixture.id,
    )
  )
    fail('Missing authoritative text paint event')
  if (
    identity.plugin === 'tree-sitter' &&
    !observation.paints.some(
      (event) =>
        event.phase === 'highlight-settled' &&
        event.status === 'painted' &&
        event.documentId === identity.fixture.id,
    )
  )
    fail('Missing authoritative highlighted paint event')
  if (observation.droppedDiagnostics) fail('Diagnostic observations were truncated')
  if (!values.diagnostics && observation.diagnostics.length)
    fail('Diagnostics active in production run')
}

async function fallbackCases({ page, cdp }, identity, result) {
  const commands = [await page.evaluate(() => __firstPaint.foldCommand('fold'))]
  if (!commands[0].changed) fail('Explicit cold fold did not find the first offscreen scope')
  await verifyOuterFold(page, identity.fixture.id)
  const folded = await paintEvidence(page, page.locator('#view-0 [data-editor-virtual-row="0"]'))
  commands.push(await page.evaluate(() => __firstPaint.foldCommand('unfoldAll')))
  await cdp.send('HeapProfiler.collectGarbage')
  const initialHeap = await cdp.send('Runtime.getHeapUsage')
  const bursts = []
  for (let index = 0; index < 3; index++) {
    await page.evaluate(() => __firstPaint.beginEditBurst())
    await page.keyboard.type('xxxxxxxxxxxx', { delay: 16 })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    bursts.push(await page.evaluate(() => __firstPaint.finishEditBurst()))
    await page.waitForTimeout(600)
  }
  commands.push(await page.evaluate(() => __firstPaint.foldCommand('foldAll')))
  await verifyOuterFold(page, identity.fixture.id)
  commands.push(await page.evaluate(() => __firstPaint.foldCommand('unfoldAll')))
  await cdp.send('HeapProfiler.collectGarbage')
  const editedHeap = await cdp.send('Runtime.getHeapUsage')
  const screenshot = await fallbackScreenshot(page, identity, result)
  return { commands, bursts, folded, initialHeap, editedHeap, screenshot }
}

async function verifyOuterFold(page, fixture) {
  const nextDisplayRow = page.locator('#view-0 [data-editor-virtual-row="1"]')
  if (fixture !== 'short-lines') return expect(nextDisplayRow).toHaveCount(0)
  await expect(nextDisplayRow).toContainText('const value5000 = ')
}

async function fallbackScreenshot(page, identity, result) {
  if (identity.repetition !== 0 || identity.state !== 'cold') return null
  await expect(page.locator('#view-0 [data-editor-virtual-row="0"]')).toContainText('const needle0')
  const marker = page.locator('#view-0 .editor-virtualized-fold-toggle[aria-label]').first()
  const markerPixels = result.config.foldGutter ? await paintEvidence(page, marker, false, 8) : null
  const path = `${resolve(values.output)}.${identity.fixture.id}.${identity.mode}.png`
  await mkdir(dirname(path), { recursive: true })
  await page.locator('#view-0').screenshot({ path, animations: 'disabled' })
  return { path, markerPixels }
}
