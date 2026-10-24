import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { fail } from './errors.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    sizes: { type: 'string', default: '10485760' },
    modes: { type: 'string', default: 'resident,streamed,paged' },
  },
})
if (!values.output) fail('--output is required')
const sizes = values.sizes.split(',').map(Number)
const modes = values.modes.split(',')
if (sizes.some((size) => !Number.isSafeInteger(size) || size < 1024)) fail('Invalid sizes')
if (modes.some((mode) => !['resident', 'streamed', 'paged'].includes(mode))) fail('Invalid modes')
// NOT-PORTABLE: mkdtemp requires /work/tmp, which this script does not create.
const directory = await mkdtemp('/work/tmp/editor-e015-build-')
await mkdir(dirname(resolve(values.output)), { recursive: true })
let browser
const result = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  at: new Date().toISOString(),
  memory:
    'CDP main-renderer heap after GC; peak is sampled JS heap and may miss brief allocations; excludes process RSS',
  viewport: { width: 1200, height: 720 },
  sizes,
  modes,
  samples: [],
}
try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    worker: { format: 'es' },
    build: { outDir: directory, rolldownOptions: { input: resolve(root, 'paged.html') } },
  })
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: directory } })
  result.browser = browser.version()
  for (const size of sizes) for (const mode of modes) result.samples.push(await sample(size, mode))
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}

async function asset(route) {
  const path = resolve(directory, '.' + new URL(route.request().url()).pathname)
  if (!path.startsWith(directory + sep)) return route.abort()
  await route.fulfill({
    body: await readFile(path),
    contentType:
      { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[extname(path)] ??
      'application/octet-stream',
  })
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  return cdp.send('Runtime.getHeapUsage')
}

async function sample(size, mode) {
  const context = await browser.newContext({ viewport: result.viewport })
  try {
    await context.route('https://paged.local/**', asset)
    const page = await context.newPage()
    await page.goto('https://paged.local/paged.html')
    const cdp = await context.newCDPSession(page)
    const emptyHeap = await heap(cdp)
    let peakHeap = emptyHeap.usedSize
    const timer = setInterval(() => {
      cdp
        .send('Runtime.getHeapUsage')
        .then((usage) => {
          peakHeap = Math.max(peakHeap, usage.usedSize)
        })
        .catch(() => {})
    }, 100)
    let opened
    let checks = null
    try {
      opened = await page.evaluate(
        ({ size, mode }) => (mode === 'paged' ? __paged.open(size) : __paged.compare(mode, size)),
        { size, mode },
      )
      if (mode === 'paged') checks = await verifyRanges(page, opened, size)
    } finally {
      clearInterval(timer)
    }
    const liveHeap = await heap(cdp)
    peakHeap = Math.max(peakHeap, liveHeap.usedSize)
    if (mode === 'paged' && opened.bytes > 8 * 1024 * 1024) await verifyPendingAndRevision(page)
    await page.evaluate(() => __paged.dispose())
    const disposedHeap = await heap(cdp)
    const row = { mode, size, opened, checks, emptyHeap, liveHeap, peakHeap, disposedHeap }
    console.log(JSON.stringify(row))
    return row
  } finally {
    await context.close()
  }
}

async function verifyRanges(page, opened, size) {
  const first = '[data-line="1"] [data-text]'
  if ((await page.locator(first).textContent()) !== opened.tile.trimEnd())
    fail('Initial visible range differs')
  await page.screenshot({ path: `${values.output}.${size}.first.png` })
  const farLine = Math.floor(opened.stats.lines * 0.9)
  const start = performance.now()
  await page.getByRole('spinbutton', { name: 'Global line number' }).fill(String(farLine + 1))
  await page.getByRole('button', { name: 'Go to line', exact: true }).click()
  await page.locator(`[data-line="${farLine + 1}"]`).waitFor()
  const jumpMs = performance.now() - start
  if (
    (await page.locator(`[data-line="${farLine + 1}"] [data-text]`).textContent()) !==
    opened.tile.trimEnd()
  )
    fail('Distant visible range differs')
  await page.getByRole('button', { name: 'Copy first visible line' }).click()
  await page.waitForFunction(() => document.querySelector('output')?.textContent)
  if ((await page.locator('output').textContent()) !== opened.tile.slice(0, -1))
    fail('Copied line differs')
  const copied = await page.evaluate(({ from, to }) => __paged.copy(from, to), {
    from: farLine * opened.tile.length + 2,
    to: farLine * opened.tile.length + 7,
  })
  if (copied !== opened.tile.slice(2, 7)) fail('UTF-16 range copy differs')
  await page.screenshot({ path: `${values.output}.${size}.far.png` })
  // A cache smaller than the file makes returning to line zero fetch again.
  const sweep = await page.evaluate(() => __paged.sweep())
  if (sweep.peakCachedBytes > 8 * 1024 * 1024 || sweep.checkpoints > 4096 || sweep.peakInFlight > 2)
    fail('Paged resource bounds exceeded')
  return { jumpMs, copied, sweep, stats: await page.evaluate(() => __paged.stats()) }
}

async function verifyPendingAndRevision(page) {
  await page.evaluate(() => __paged.setDelay(100))
  const pending = page.evaluate(() => __paged.show(0))
  await page.getByRole('status').filter({ hasText: 'Loading line 1' }).waitFor()
  await pending
  await page.evaluate(() => __paged.setDelay(0))
  await page.evaluate(() => __paged.show(100))
  await page.evaluate(() => __paged.changeRevision())
  await page.evaluate(() => __paged.show(5000))
  await page.getByRole('status').filter({ hasText: 'file changed' }).waitFor()
}
