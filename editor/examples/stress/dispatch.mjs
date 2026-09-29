// Back-to-back view contribution passes: fixed interested work against irrelevant pieces (T1), and
// the marginal cost per interested piece (T2). Usage: node dispatch.mjs [--output file]
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { build } from 'vite'

const root = dirname(fileURLToPath(import.meta.url))
const repository = resolve(root, '../..')
const { values } = parseArgs({
  options: {
    output: { type: 'string', default: '/work/tmp/editor-dispatch/result.json' },
    'core-dist': { type: 'string', default: resolve(repository, 'packages/editor/dist') },
  },
})
const coreDist = resolve(values['core-dist'])
await mkdir('/work/tmp', { recursive: true })
const directory = await mkdtemp('/work/tmp/editor-dispatch-')
const cases = [
  { suite: 'irrelevant', interested: 1, irrelevant: 0 },
  { suite: 'irrelevant', interested: 1, irrelevant: 1_000 },
  { suite: 'interested', interested: 1_000, irrelevant: 0 },
  { suite: 'interested', interested: 2_000, irrelevant: 0 },
  { suite: 'interested', interested: 4_000, irrelevant: 0 },
]
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
    build: {
      outDir: directory,
      emptyOutDir: true,
      rollupOptions: { input: resolve(root, 'dispatch.html') },
    },
  })
  browser = await chromium.launch({ headless: true, env: { ...process.env, TMPDIR: directory } })
  const samples = []
  for (const setup of cases) {
    const page = await browser.newPage({ viewport: { width: 1000, height: 700 } })
    await page.route('http://dispatch.local/**', routeAsset)
    await page.goto('http://dispatch.local/dispatch.html')
    await page.waitForFunction(() => 'dispatch' in window)
    await page.evaluate((options) => window.dispatch.setup(options), setup)
    const sample = await page.evaluate(() => window.dispatch.measure())
    samples.push({ ...setup, ...sample })
    console.log(
      `${setup.suite.padEnd(10)} interested=${String(setup.interested).padEnd(5)} irrelevant=${String(setup.irrelevant).padEnd(5)} calls/pass=${sample.calls.toFixed(0).padStart(5)} µs/pass=${sample.medianUs.toFixed(1)}`,
    )
    await page.close()
  }
  const perPiece = (from, to) =>
    ((samples.find((s) => s.interested === to).medianUs -
      samples.find((s) => s.interested === from).medianUs) /
      (to - from)) *
    1000
  const summary = {
    t1IrrelevantDeltaUs: samples[1].medianUs - samples[0].medianUs,
    t2NsPerInterested1000To2000: perPiece(1_000, 2_000),
    t2NsPerInterested2000To4000: perPiece(2_000, 4_000),
  }
  console.log(JSON.stringify(summary))
  await mkdir(dirname(resolve(values.output)), { recursive: true })
  await writeFile(
    values.output,
    JSON.stringify({ createdAt: new Date().toISOString(), samples, summary }) + '\n',
  )
} finally {
  await browser?.close()
  await rm(directory, { recursive: true, force: true })
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
    await route.fulfill({ status: 404 })
  }
}
