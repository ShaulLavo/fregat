import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { loadCorePackage } from './core-package.mjs'
import { fail } from './errors.mjs'
import { workerHeaps } from './worker-memory.mjs'

// E033's acceptance workload: two views over a fragmented document, plain or with Markdown,
// scope-lines, decode and a conflict already present, typed into and undone inside that conflict.
const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    diagnostics: { type: 'boolean', default: false },
    sizes: { type: 'string', default: '65536,4194304,50331648' },
    configs: { type: 'string', default: 'plain,contributions' },
    operations: { type: 'string', default: '200' },
    warmups: { type: 'string', default: '20' },
    'key-delay': { type: 'string', default: '0' },
    views: { type: 'string', default: '2' },
    'core-directory': { type: 'string', default: resolve(root, '../../packages/editor') },
  },
})
if (!values.output) fail('--output is required')
const sizes = values.sizes.split(',').map(Number)
const configs = values.configs.split(',')
const operations = Number(values.operations)
const warmups = Number(values.warmups)
const keyDelay = Number(values['key-delay'])
const viewCount = Number(values.views)
if (viewCount !== 1 && viewCount !== 2) fail('views must be 1 or 2')
if (!Number.isFinite(keyDelay) || keyDelay < 0) fail('Invalid key-delay')
if (![...sizes, operations, warmups].every((value) => Number.isSafeInteger(value) && value > 0))
  fail('Invalid sizes/operations/warmups')
if (!configs.every((config) => ['plain', 'contributions', 'minimap', 'folds'].includes(config)))
  fail('Configs are plain, contributions, minimap and folds')

// NOT-PORTABLE: Scratch creation requires /work/tmp.
await mkdir('/work/tmp', { recursive: true })
const directory = await mkdtemp('/work/tmp/editor-e033-build-')
const core = await loadCorePackage(values['core-directory'])
let browser
const result = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: core.directory,
    encoding: 'utf8',
  }).trim(),
  dirtyFiles: execFileSync('git', ['status', '--short'], { cwd: core.directory, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean).length,
  diagnostics: values.diagnostics,
  operations,
  warmups,
  keyDelay,
  viewCount,
  sizes,
  configs,
  viewport: { width: 1000, height: 1000 },
  memoryBoundary: 'main-renderer CDP heap after forced GC; excludes worker heap',
  samples: [],
}
try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: core.aliases },
    worker: { format: 'es' },
    build: { outDir: directory, rolldownOptions: { input: resolve(root, 'boundary.html') } },
  })
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info', '--js-flags=--max-old-space-size=8192'],
    env: { ...process.env, TMPDIR: directory },
  })
  result.browser = browser.version()
  for (const config of configs)
    for (const size of sizes) result.samples.push(await sample(config, size))
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ output: values.output, configs, sizes }))
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}

async function asset(route) {
  const path = resolve(directory, '.' + new URL(route.request().url()).pathname)
  if (!path.startsWith(directory + sep)) return route.abort()
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }
  await route.fulfill({
    body: await readFile(path),
    contentType: types[extname(path)] ?? 'application/octet-stream',
  })
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')).usedSize
}

async function sample(config, size) {
  const context = await browser.newContext({ viewport: result.viewport })
  const errors = []
  try {
    await context.route('http://boundary.local/**', asset)
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('http://boundary.local/boundary.html')
    const cdp = await context.newCDPSession(page)
    const emptyHeap = await heap(cdp)
    const open = await page.evaluate(
      ({ size, config, diagnostics, viewCount }) =>
        __boundary.open(size, config, diagnostics, viewCount),
      { size, config, diagnostics: values.diagnostics, viewCount },
    )
    await page.evaluate(() => __boundary.settle())
    // The contributions must be doing their work, or their cost is not in the measurement. Decode's
    // opening reveal runs for about a second; steady state starts after it.
    if (config === 'contributions') {
      await page.waitForTimeout(2_000)
      await page.locator('#view-0 .editor-merge-conflict-lens').first().waitFor({ timeout: 10_000 })
      await page.screenshot({ path: `${values.output}.${config}.${size}.png` })
    }
    if (config === 'minimap' || config === 'folds') {
      await page.waitForTimeout(5_000)
      await page.screenshot({ path: `${values.output}.${config}.${size}.png` })
    }
    open.settleReads = await page.evaluate(() => __boundary.takeReads())
    const openHeap = await heap(cdp)
    const openWorkers = await workerHeaps(browser)

    await burst(page, 'typing', warmups)
    const typing = await burst(page, 'typing', operations)
    await burst(page, 'undo', warmups)
    const undo = await burst(page, 'undo', operations)
    const exported = await page.evaluate(() => __boundary.exportText())
    const liveHeap = await heap(cdp)
    const liveWorkers = await workerHeaps(browser)

    await page.evaluate(() => __boundary.dispose())
    await page.evaluate(() => __boundary.settle())
    const disposedHeap = await heap(cdp)
    const retained = await page.evaluate(() => __boundary.retained())
    if (retained !== 0) fail(`Disposed editor or buffer retained (${config}, ${size})`)
    if (errors.length) fail(`Browser errors: ${errors.join('; ')}`)
    const row = {
      config,
      size,
      length: open.length,
      heap: { emptyHeap, openHeap, liveHeap, disposedHeap },
      workers: { open: openWorkers, live: liveWorkers },
      open,
      typing,
      undo,
      exported,
      retained,
    }
    console.log(
      JSON.stringify({
        config,
        size,
        typingP95: p95(typing.inputToApplied),
        undoP95: p95(undo.inputToApplied),
        openMs: open.openMs,
        exportMs: exported.exportMs,
      }),
    )
    return row
  } finally {
    await context.close()
  }
}

/** One measured burst: native keys through the probe, reads taken before its own full check. */
async function burst(page, scenario, count) {
  const target = await page.evaluate(
    ({ scenario, count }) => {
      const target = __boundary.probe.prepare(scenario, 0)
      if (scenario === 'undo') __boundary.probe.seedUndo(count)
      return target
    },
    { scenario, count },
  )
  await page.evaluate(() => __boundary.settle())
  await page.evaluate(() => __boundary.takeReads())
  await page.evaluate(() => __boundary.probe.start())
  const inserted = scenario === 'typing' ? 'x'.repeat(count) : ''
  if (scenario === 'typing') await page.keyboard.type(inserted, { delay: keyDelay })
  for (let index = 0; scenario === 'undo' && index < count; index++)
    await page.keyboard.press('Control+z')
  await page.evaluate(() => new Promise(requestAnimationFrame))
  await page.evaluate(() => __boundary.settle())
  const reads = await page.evaluate(() => __boundary.takeReads())
  const observation = await page.evaluate(
    ({ inserted, count }) => __boundary.probe.finish(inserted, count),
    { inserted, count },
  )
  if (inserted)
    await page.evaluate((args) => __boundary.advance(...args), [inserted, target.offset])
  return {
    count,
    reads,
    inputToApplied: observation.events.map((event) => event.appliedAt - event.at),
    dispatch: observation.events.map((event) => event.completedAt - event.dispatchAt),
    inputToFrame: observation.events.map((event) => event.frameAt - event.at),
  }
}

function p95(values) {
  const sorted = values.toSorted((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]
}
