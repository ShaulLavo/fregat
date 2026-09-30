import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'
import { loadCorePackage } from './core-package.mjs'
import { fail } from './errors.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    diagnostics: { type: 'boolean', default: false },
    sizes: { type: 'string', default: '65536,4194304,50331648' },
    repetitions: { type: 'string', default: '5' },
    'core-directory': { type: 'string', default: resolve(root, '../../packages/editor') },
    consumers: { type: 'boolean', default: false },
  },
})
if (!values.output) fail('--output is required')
const sizes = values.sizes.split(',').map(Number)
const repetitions = Number(values.repetitions)
if (![...sizes, repetitions].every((value) => Number.isSafeInteger(value) && value > 0))
  fail('Invalid sizes/repetitions')
await mkdir('/work/tmp', { recursive: true })
const directory = await mkdtemp('/work/tmp/editor-e007-build-')
const core = await loadCorePackage(values['core-directory'])
let browser
const result = {
  commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: core.directory,
    encoding: 'utf8',
  }).trim(),
  diff: execFileSync('git', ['diff', '--', 'src/shiki/workerClient.ts'], {
    cwd: core.directory,
    encoding: 'utf8',
  }),
  diagnostics: values.diagnostics,
  consumers: values.consumers,
  repetitions,
  sizes,
  samples: [],
  memoryBoundary: 'main-renderer CDP heap after forced GC; excludes worker heap',
}
try {
  await build({
    root,
    configFile: false,
    logLevel: 'error',
    resolve: { alias: core.aliases },
    worker: { format: 'es' },
    build: {
      outDir: directory,
      rolldownOptions: {
        input: resolve(root, values.consumers ? 'consumers.html' : 'copies.html'),
      },
    },
  })
  browser = await chromium.launch({
    headless: true,
    args: ['--enable-precise-memory-info'],
    env: { ...process.env, TMPDIR: directory },
  })
  result.browser = browser.version()
  for (const size of sizes) result.samples.push(await sample(size))
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify({ output: values.output, sizes }))
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
}

async function asset(route) {
  const path = resolve(directory, '.' + new URL(route.request().url()).pathname)
  if (!path.startsWith(directory + sep)) return route.abort()
  const types = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.wasm': 'application/wasm',
    '.css': 'text/css',
  }
  await route.fulfill({
    body: await readFile(path),
    contentType: types[extname(path)] ?? 'application/octet-stream',
  })
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')).usedSize
}

async function sample(size) {
  const context = await browser.newContext()
  try {
    await context.route('http://copies.local/**', asset)
    const page = await context.newPage()
    await page.goto(`http://copies.local/${values.consumers ? 'consumers' : 'copies'}.html`)
    const cdp = await context.newCDPSession(page)
    if (values.consumers) return await combinedSample(page, cdp, size)
    const emptyHeap = await heap(cdp)
    const open = await page.evaluate(({ size, diagnostics }) => __copies.open(size, diagnostics), {
      size,
      diagnostics: values.diagnostics,
    })
    const openHeap = await heap(cdp)
    const operations = await page.evaluate((count) => __copies.run(count), repetitions)
    const liveHeap = await heap(cdp)
    await page.evaluate(() => __copies.dispose())
    const disposedHeap = await heap(cdp)
    const retained = await page.evaluate(() => __copies.retained())
    if (retained !== 0) fail('Disposed session/snapshot retained')
    const row = { size, emptyHeap, openHeap, liveHeap, disposedHeap, retained, open, operations }
    console.log(JSON.stringify(row))
    return row
  } finally {
    await context.close()
  }
}

async function combinedSample(page, cdp, size) {
  const emptyHeap = await heap(cdp)
  await page.evaluate(({ size, diagnostics }) => __consumers.open(size, diagnostics), {
    size,
    diagnostics: values.diagnostics,
  })
  await page.waitForFunction(() => __consumers.observe().state.initialHighlightStatus === 'painted')
  const openHeap = await heap(cdp)
  const open = await page.evaluate(() => __consumers.observe())
  await page.evaluate(() => __consumers.reset())
  await page.keyboard.type('abcdefghijklmnopqrst', { delay: 0 })
  await page.evaluate(() => __consumers.settle())
  const edited = await page.evaluate(() => __consumers.observe())
  if (edited.state.length !== size + 20) fail('Combined edit did not reach the buffer')
  await page.keyboard.press('Control+z')
  await page.evaluate(() => __consumers.settle())
  const undone = await page.evaluate(() => __consumers.observe())
  if (undone.state.length !== size) fail('Combined undo did not restore the buffer')
  await page.keyboard.press('Control+f')
  await page.keyboard.type('needle')
  const search = page.getByRole('textbox', { name: /find/i }).first()
  await search.waitFor()
  const expectedMatches = Math.floor((size + 4090) / 4096)
  await page.waitForFunction((count) => {
    const label = document.querySelector('.editor-find-count')?.textContent
    return count === 0 ? label === 'No results' : label?.endsWith(`of ${count}`)
  }, expectedMatches)
  await page.screenshot({ path: `${values.output}.${size}.png` })
  const find = await page.evaluate(() => __consumers.observe())
  const liveHeap = await heap(cdp)
  await page.evaluate(() => __consumers.dispose())
  const disposedHeap = await heap(cdp)
  const retained = await page.evaluate(() => __consumers.retained())
  if (retained !== 0) fail('Combined editor/buffer retained after disposal')
  return { size, emptyHeap, openHeap, liveHeap, disposedHeap, retained, open, edited, undone, find }
}
