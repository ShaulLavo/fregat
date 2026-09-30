import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { cpus } from 'node:os'
import { extname, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium, expect } from '@playwright/test'
import { build } from 'vite'
import { loadCorePackage } from '../../../examples/stress/core-package.mjs'
import { paintEvidence } from '../../../examples/stress/scenarios.mjs'
import { hashDirectory, rebuildPackage } from './editBatchesBuild.mjs'
import {
  defaultSeed,
  generateFixture,
  generatorVersion,
} from '../../../examples/stress/src/fixtures.ts'

const { values } = parseArgs({
  options: {
    'core-directory': { type: 'string', default: resolve(import.meta.dirname, '..') },
    output: { type: 'string' },
    repetitions: { type: 'string', default: '10' },
    warmups: { type: 'string', default: '2' },
    group: { type: 'string' },
    'require-incremental': { type: 'boolean', default: false },
    'verify-guards': { type: 'boolean', default: false },
  },
})
assert.ok(values.output, 'Pass --output result.json')
const repetitions = Number(values.repetitions)
const warmups = Number(values.warmups)
assert.ok(Number.isSafeInteger(repetitions) && repetitions > 0)
assert.ok(Number.isSafeInteger(warmups) && warmups >= 0)
assert.ok(
  !values['verify-guards'] || values.group === undefined,
  '--verify-guards uses its fixed control groups',
)
const selectedGroups = selectGroups(values.group)
const minimumChromaticPixels = 20
const decoratedHighlightRow = 2
const coreBuild = await rebuildPackage(values['core-directory'], '@singapore-editor/core')
const core = await loadCorePackage(coreBuild.directory)
const { sourceSha256, builtSha256 } = coreBuild
const directory = await mkdtemp('/work/tmp/e032-browser-')
const entry = resolve(import.meta.dirname, 'editBatchesBrowser.mjs')
const html =
  '<!doctype html><html><head><style>body{margin:8px;background:white;color:black}</style></head><body><script type="module" src="/entry.mjs"></script></body></html>'
await writeFile(join(directory, 'index.html'), html)
await writeFile(
  join(directory, 'entry.mjs'),
  `import { bridge } from ${JSON.stringify(entry)}\nObject.assign(globalThis, { __e032: bridge })\n`,
)
await build({
  root: directory,
  configFile: false,
  logLevel: 'warn',
  resolve: { alias: core.aliases },
  build: {
    outDir: join(directory, 'dist'),
    rollupOptions: { input: join(directory, 'index.html') },
  },
})
const browser = await chromium.launch({
  headless: true,
  env: { ...process.env, TMPDIR: directory },
})
try {
  const captured = values['verify-guards'] ? await verifyGuards() : await captureGroups()
  assert.equal(
    await hashDirectory(core.sourceDirectory),
    sourceSha256,
    'Sources changed during capture',
  )
  assert.equal(
    await hashDirectory(resolve(core.directory, 'dist')),
    builtSha256,
    'Built package changed during capture',
  )
  const result = {
    capturedAt: new Date().toISOString(),
    coreDirectory: core.directory,
    sourceSha256,
    builtSha256,
    buildProvenance: coreBuild.provenance,
    browser: browser.version(),
    runtime: process.version,
    cpu: cpus()[0]?.model,
    generatorVersion,
    seed: defaultSeed,
    benchmarkProtocolVersion: 3,
    requireIncremental: values['require-incremental'],
    configuration: {
      viewport: { width: 1000, height: 1000 },
      editor: { width: 800, height: 800, rowHeight: 20, characterWidth: 8 },
      wrap: false,
      syntax: false,
      diagnosticsInTimingSamples: false,
      delivery: 'vite-production-playwright-route',
      groupFilter: values['verify-guards']
        ? ['ordinary:single-edit:plain', 'ordinary:single-edit:decorated']
        : (values.group ?? null),
      decoratedHighlightRow,
      minimumChromaticPixels,
      paintBoundary: 'completion-of-prefix-and-decorated-source-row-screenshots',
      projectionValidation: 'synchronous-and-after-required-screenshots',
      fullTextReadValidation: 'synchronous-and-deferred-through-required-screenshots',
    },
    measurement:
      'Programmatic Editor.edit to completion of the required screenshots, not trusted input. Plain groups capture the prefix row; decorated groups also capture retained highlighted source text. The paint upper bound includes projection inspection, automation, and screenshot overhead. Synchronous commit is measured separately. Diagnostic runs include deferred consumers until the required captures finish. Forced-GC heap covers the main renderer with the final editor retained.',
    ...captured,
  }
  await writeFile(resolve(values.output), JSON.stringify(result, null, 2) + '\n')
} finally {
  await browser.close()
  await rm(directory, { recursive: true, force: true })
}

async function captureGroups() {
  const groups = []
  for (const group of selectedGroups)
    groups.push(await runGroup(group.fixture, group.kind, group.decorated))
  assert.equal(groups.length, selectedGroups.length)
  return { kind: 'timings', repetitions, warmups, groups }
}

function selectGroups(filter) {
  const available = [
    'ordinary:single-edit:plain',
    'ordinary:sparse-batch:plain',
    'ordinary:single-edit:decorated',
    'ordinary:sparse-batch:decorated',
    'long-line:single-edit:plain',
    'long-line:sparse-batch:plain',
    'short-lines:single-edit:plain',
    'short-lines:sparse-batch:plain',
    'short-lines:single-edit:decorated',
    'short-lines:sparse-batch:decorated',
  ]
  const selected = filter === undefined ? available : [filter]
  assert.ok(
    selected.every((group) => available.includes(group)),
    `Expected --group to be one of ${available.join(', ')}`,
  )
  return selected.map((group) => {
    const [fixture, kind, projection] = group.split(':')
    return { fixture, kind, decorated: projection === 'decorated' }
  })
}

async function runGroup(fixture, kind, decorated = false) {
  const { context, page, cdp, errors } = await openSession()
  for (let index = 0; index < warmups; index++) await sample(page, fixture, kind, false, decorated)
  const samples = []
  for (let index = 0; index < repetitions; index++)
    samples.push(await sample(page, fixture, kind, false, decorated))
  const diagnostic = await sample(page, fixture, kind, true, decorated)
  const retained = await memory(cdp)
  await page.evaluate(() => __e032.dispose())
  const disposed = await memory(cdp)
  assert.deepEqual(errors, [])
  await context.close()
  const summary = {
    fixture,
    kind,
    decorated,
    fixtureSha256: createHash('sha256').update(generateFixture(fixture)).digest('hex'),
    commitP50Ms: percentile(
      samples.map((value) => value.commitMs),
      0.5,
    ),
    commitP95Ms: percentile(
      samples.map((value) => value.commitMs),
      0.95,
    ),
    paintUpperBoundP50Ms: percentile(
      samples.map((value) => value.paintUpperBoundMs),
      0.5,
    ),
    paintUpperBoundP95Ms: percentile(
      samples.map((value) => value.paintUpperBoundMs),
      0.95,
    ),
    retained,
    disposed,
    diagnostic,
    samples,
  }
  console.log(
    JSON.stringify({
      fixture,
      kind,
      decorated,
      commitP50Ms: summary.commitP50Ms,
      commitP95Ms: summary.commitP95Ms,
      paintUpperBoundP95Ms: summary.paintUpperBoundP95Ms,
      retained,
    }),
  )
  return summary
}

async function openSession() {
  const context = await browser.newContext({
    viewport: { width: 1000, height: 1000 },
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  await context.route('**/*', serveAsset)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('http://e032.local/')
  await page.waitForFunction(() => !!globalThis.__e032)
  return { context, page, cdp, errors }
}

async function sample(page, fixture, kind, instrumented, decorated, control = {}) {
  await page.evaluate(
    ({ fixture, kind, instrumented, decorated }) =>
      __e032.prepare(fixture, kind, instrumented, decorated),
    { fixture, kind, instrumented, decorated },
  )
  const row = page.locator('[data-editor-virtual-row="0"]')
  await expect(row).toBeVisible()
  await paintEvidence(page, row)
  const result = await page.evaluate(() => __e032.edit())
  if (control.fault === 'full-read-next-frame') {
    await page.evaluate(() => __e032.fullReadOnNextFrame())
  }
  await expect(row).toContainText('prefix')
  const paint = await paintEvidence(page, row)
  await applyGuardFault(page, control.fault)
  const highlightedSource = decorated ? await captureHighlightedSource(page) : null
  const correctness = await page.evaluate(() => __e032.inspect())
  assert.equal(correctness.textCorrect, true)
  assert.equal(correctness.suffixCorrect, true)
  const observation = {
    decorated,
    commitMs: result.committedAt - result.startedAt,
    paintUpperBoundMs: (highlightedSource?.completedAt ?? paint.completedAt) - result.startedAt,
    pixels: paint.pixels,
    highlightedSource,
    synchronous: result.synchronous,
    projections: result.projections,
    correctness,
  }
  if (values['require-incremental'] && control.enforce !== false) requireIncremental(observation)
  return observation
}

function requireIncremental(result) {
  assert.equal(result.synchronous.fullTextReads, 0)
  assert.equal(result.correctness.deferred.fullTextReads, 0, 'Deferred full-document read')
  if (!result.decorated) return
  assert.ok(result.projections, 'Synchronous projections are missing')
  assert.equal(result.projections.tokensCorrect, true)
  assert.equal(result.projections.foldCorrect, true)
  assert.equal(
    result.correctness.projections?.tokensCorrect,
    true,
    'Post-screenshot tokens changed',
  )
  assert.equal(result.correctness.projections?.foldCorrect, true, 'Post-screenshot folds changed')
  assert.ok(
    result.highlightedSource?.pixels.chromatic >= minimumChromaticPixels,
    'Retained source token has no chromatic pixels',
  )
}

async function captureHighlightedSource(page) {
  const row = page.locator(`[data-editor-virtual-row="${decoratedHighlightRow}"]`)
  await expect(row).toContainText('const')
  return paintEvidence(page, row)
}

async function applyGuardFault(page, fault) {
  if (fault === 'clear-highlights') await page.evaluate(() => CSS.highlights.clear())
  if (fault === 'clear-folds-next-frame') await page.evaluate(() => __e032.clearFoldsOnNextFrame())
}

async function verifyGuards() {
  const { context, page, errors } = await openSession()
  const positive = await sample(page, 'ordinary', 'single-edit', true, true, { enforce: false })
  requireIncremental(positive)
  const highlights = await sample(page, 'ordinary', 'single-edit', true, true, {
    enforce: false,
    fault: 'clear-highlights',
  })
  assert.throws(
    () => requireIncremental(highlights),
    /Retained source token has no chromatic pixels/,
  )
  const folds = await sample(page, 'ordinary', 'single-edit', true, true, {
    enforce: false,
    fault: 'clear-folds-next-frame',
  })
  assert.throws(() => requireIncremental(folds), /Post-screenshot folds changed/)
  const deferredReads = []
  for (const decorated of [false, true]) {
    const observation = await sample(page, 'ordinary', 'single-edit', true, decorated, {
      enforce: false,
      fault: 'full-read-next-frame',
    })
    assert.equal(observation.synchronous.fullTextReads, 0)
    assert.equal(observation.correctness.deferred.fullTextReads, 1)
    assert.throws(() => requireIncremental(observation), /Deferred full-document read/)
    deferredReads.push({
      fault: 'full-read-next-frame',
      expected: 'deferred-full-read-guard-rejected',
      observation,
    })
  }
  assert.deepEqual(errors, [])
  await context.close()
  return {
    kind: 'guard-proof',
    controls: [
      { fault: null, expected: 'accepted', observation: positive },
      {
        fault: 'clear-highlights',
        expected: 'chromatic-pixel-guard-rejected',
        observation: highlights,
      },
      {
        fault: 'clear-folds-next-frame',
        expected: 'post-screenshot-fold-guard-rejected',
        observation: folds,
      },
      ...deferredReads,
    ],
  }
}

async function memory(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  return { usedBytes: heap.usedSize, ...(await cdp.send('Memory.getDOMCounters')) }
}

async function serveAsset(route) {
  const pathname = decodeURIComponent(new URL(route.request().url()).pathname)
  const file = resolve(directory, 'dist', pathname === '/' ? 'index.html' : `.${pathname}`)
  assert.ok(file.startsWith(resolve(directory, 'dist') + '/'))
  const body = await readFile(file)
  const contentType =
    { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(file)] ??
    'application/octet-stream'
  await route.fulfill({ status: 200, contentType, body })
}

function percentile(samples, proportion) {
  const sorted = samples.toSorted((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * proportion) - 1)]
}
