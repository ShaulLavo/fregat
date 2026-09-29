import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium, expect } from '@playwright/test'
import { build } from 'vite'
import { fail } from './errors.mjs'
import { createManifest } from './fixtures.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '../..')
const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/work/tmp/editor-e004/result.json' },
    'core-dist': { type: 'string', default: resolve(repository, 'packages/editor/dist') },
    repetitions: { type: 'string', default: '3' },
    'expect-suspended': { type: 'boolean', default: false },
  },
})
const repetitions = Number(values.repetitions)
if (!Number.isSafeInteger(repetitions) || repetitions < 1) fail('Invalid repetitions')
const coreDist = resolve(values['core-dist'])
const manifest = createManifest(60061)
manifest.fixtures = manifest.fixtures.filter((fixture) =>
  ['ordinary', 'short-lines', 'long-line'].includes(fixture.id),
)
await mkdir('/work/tmp', { recursive: true })
const directory = await mkdtemp('/work/tmp/editor-hidden-')
let browser

try {
  const pkg = JSON.parse(await readFile(resolve(repository, 'packages/editor/package.json')))
  const aliases = Object.entries(pkg.exports).map(([name, target]) => ({
    find: name === '.' ? '@singapore-editor/core' : '@singapore-editor/core' + name.slice(1),
    replacement: resolve(
      coreDist,
      (typeof target === 'string' ? target : target.import).replace('./dist/', ''),
    ),
  }))
  await build({
    root,
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: aliases.sort((left, right) => right.find.length - left.find.length) },
    worker: { format: 'es' },
    build: { outDir: directory, emptyOutDir: true },
  })
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: directory } })
  const result = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    manifest,
    config: {
      repetitions,
      seed: 60061,
      churnCycles: 100,
      views: 'two-visible-one-hidden',
      syntax: 'tree-sitter-typescript-on-ordinary-only',
      viewport: { width: 1000, height: 1000 },
      delivery: 'vite-production-playwright-route',
      revealMeasurement: 'screenshot-completion-upper-bound',
      revealReadyMeasurement: 'visible-updated-row-observation-with-animation-frame-polling',
      memory: 'chromium-cdp-forced-gc-main-renderer',
      expectSuspended: values['expect-suspended'],
    },
    environment: {
      commit: execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: repository,
        encoding: 'utf8',
      }).trim(),
      coreDistHash: await hashDirectory(coreDist),
      browser: browser.version(),
      runtime: process.version,
      hardware: {
        cpu: cpus()[0]?.model,
        logicalCpus: cpus().length,
        memoryBytes: totalmem(),
        arch: arch(),
        platform: platform(),
        release: release(),
      },
      unsupportedMemory: ['worker heaps', 'renderer process RSS', 'user-agent-specific memory'],
    },
    samples: [],
  }
  for (const fixture of manifest.fixtures) await runFixture(fixture, result)
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(values.output, JSON.stringify(result) + '\n')
  console.log(JSON.stringify({ event: 'hidden.complete', output: values.output }))
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}

async function hashDirectory(path) {
  const hash = createHash('sha256')
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  const paths = entries
    .filter((entry) => entry.isFile())
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort()
  for (const entry of paths) hash.update(entry.slice(path.length)).update(await readFile(entry))
  return hash.digest('hex')
}

async function routeAsset(route) {
  const url = new URL(route.request().url())
  const path = resolve(
    directory,
    '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)),
  )
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

async function runFixture(fixture, result) {
  const context = await browser.newContext({
    viewport: result.config.viewport,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
  })
  await context.route('**/*', routeAsset)
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  page.setDefaultTimeout(30_000)
  page.on('pageerror', (error) =>
    console.error(JSON.stringify({ event: 'hidden.pageerror', message: error.message })),
  )
  try {
    await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' })
    for (let repetition = 0; repetition < repetitions; repetition++) {
      const sample = await runSample(page, cdp, fixture, repetition)
      result.samples.push(sample)
      console.log(
        JSON.stringify({
          event: 'hidden.sample',
          fixture: fixture.id,
          repetition,
          rows: sample.hidden[2].rows,
          ranges: sample.hidden[2].ranges,
          revealReadyMs: sample.revealReadyMs,
        }),
      )
    }
  } finally {
    await context.close()
  }
}

async function readMemory(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  const heap = await cdp.send('Runtime.getHeapUsage')
  return { usedBytes: heap.usedSize, ...(await cdp.send('Memory.getDOMCounters')) }
}

function observeViews(openFixture) {
  if (openFixture) __stress.open(true, openFixture === 'ordinary')
  const views = [...document.querySelectorAll('#views > section')]
  const ranges = [...CSS.highlights.values()].flatMap((highlight) => [...highlight])
  return views.map((host) => ({
    id: host.id,
    rows: host.querySelectorAll('[data-editor-virtual-row]').length,
    ranges: ranges.filter((range) => host.contains(range.startContainer)).length,
    height: host.getBoundingClientRect().height,
    text: host.querySelector('[data-editor-virtual-row="0"]')?.textContent?.slice(0, 40) ?? null,
  }))
}

async function settle(page) {
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
  )
}

async function waitSyntax(page, fixture) {
  if (fixture.id !== 'ordinary') return
  await page.waitForFunction(() => {
    const ranges = [...CSS.highlights.values()].flatMap((highlight) => [...highlight])
    return [...document.querySelectorAll('#views > section')].every(
      (host) =>
        !host.querySelector('[data-editor-virtual-row]') ||
        ranges.some((range) => host.contains(range.startContainer)),
    )
  })
}

async function runSample(page, cdp, fixture, repetition) {
  const facts = await page.evaluate((id) => __stress.prepare(id, 60061, false), fixture.id)
  if (facts.sha256 !== fixture.sha256) fail('Fixture hash mismatch')
  const before = await readMemory(cdp)
  const firstMount = await page.evaluate(observeViews, fixture.id)
  await expect(page.locator('#view-0 [data-editor-virtual-row="0"]')).toBeVisible()
  await settle(page)
  await waitSyntax(page, fixture)
  const measured = await page.evaluate(observeViews)
  const churn = await page.evaluate(() => __stress.churn(100))
  await page.evaluate(() => __stress.probeViews())
  await expect(page.locator('#view-1 [data-editor-virtual-row="0"]')).toContainText(/^probe/)
  await settle(page)
  await waitSyntax(page, fixture)
  const hidden = await page.evaluate(observeViews)
  const siblingsPreserved = hidden
    .slice(0, 2)
    .every(
      (view, index) => view.rows === measured[index].rows && view.ranges === measured[index].ranges,
    )
  if (!siblingsPreserved) fail('Hidden edits changed visible sibling rows or ranges')
  if (values['expect-suspended'] && (hidden[2].rows || hidden[2].ranges))
    fail('Hidden view retained rows or ranges')
  const hiddenMemory = await readMemory(cdp)
  const at = await page.evaluate(() => {
    const host = document.querySelector('#view-2')
    host.hidden = false
    host.style.display = 'flex'
    return performance.now()
  })
  const ready = await page.waitForFunction(() => {
    const row = document.querySelector('#view-2 [data-editor-virtual-row="0"]')
    if (!row?.textContent?.startsWith('probe') || row.getBoundingClientRect().height <= 0)
      return false
    return performance.now()
  })
  const revealReadyMs = (await ready.jsonValue()) - at
  await ready.dispose()
  await expect(page.locator('#view-2 [data-editor-virtual-row="0"]')).toBeVisible()
  await expect(page.locator('#view-2 [data-editor-virtual-row="0"]')).toContainText(/^probe/)
  await waitSyntax(page, fixture)
  await page.locator('#view-2').screenshot()
  const revealMs = await page.evaluate((at) => performance.now() - at, at)
  const revealed = await page.evaluate(observeViews)
  if (!revealed[0].rows || !revealed[1].rows || !revealed[2].rows)
    fail('Reveal lost a visible sibling')
  if (fixture.id === 'ordinary' && revealed.some((view) => !view.ranges))
    fail('Reveal lost syntax ranges')
  await page.evaluate(() => __stress.finishProbe())
  await page.evaluate(() => __stress.dispose())
  const after = await readMemory(cdp)
  const cleanup = await page.evaluate(() => __stress.retention())
  if (cleanup.active || cleanup.hosts || cleanup.pendingFrames)
    fail(`Disposed benchmark retained active resources: ${JSON.stringify(cleanup)}`)
  return {
    fixture: fixture.id,
    repetition,
    state: repetition === 0 ? 'cold' : 'warm',
    firstMount,
    measured,
    hidden,
    revealed,
    revealMs,
    revealReadyMs,
    churnMs: churn.durationMs,
    memory: { before, hidden: hiddenMemory, after },
    cleanup,
    correct: true,
  }
}
