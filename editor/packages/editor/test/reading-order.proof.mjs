import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { cpus, release } from 'node:os'
import { createServer } from 'vite'
import { chromium } from '@playwright/test'
import { fixture } from '../../../bench/compare/fixture.mjs'
import { scrollCosts, summarize } from '../../../bench/compare/protocol.mjs'

const { values } = parseArgs({
  options: {
    output: { type: 'string' },
    port: { type: 'string' },
    baseline: { type: 'boolean', default: false },
    'headings-only': { type: 'boolean', default: false },
    compare: { type: 'string' },
    condition: { type: 'string', default: 'unspecified' },
    'core-dist': { type: 'string' },
    'markdown-dist': { type: 'string' },
  },
})
assert(values.output && values.port, 'Pass --output and an explicit free --port')
const output = resolve(values.output)
await mkdir(output, { recursive: true })
const root = resolve(import.meta.dirname, '../../..')
const alias = []
for (const [folder, override] of [
  ['editor', values['core-dist']],
  ['markdown', values['markdown-dist']],
]) {
  const directory = resolve(root, 'packages', folder)
  const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
  for (const [name, entry] of Object.entries(manifest.exports)) {
    const target = typeof entry === 'string' ? entry : entry.import
    alias.push({
      find: manifest.name + (name === '.' ? '' : name.slice(1)),
      replacement: resolve(override ?? resolve(directory, 'dist'), target.replace('./dist/', '')),
    })
  }
}
alias.sort((left, right) => right.find.length - left.find.length)
const server = await createServer({
  root,
  resolve: { alias },
  configFile: false,
  publicDir: false,
  server: {
    host: '127.0.0.1',
    port: Number(values.port),
    strictPort: true,
    fs: { allow: [resolve(root, '..')] },
  },
  optimizeDeps: { exclude: ['tree-sitter-md', 'web-tree-sitter'] },
  plugins: [
    {
      name: 'reading-order-fixture',
      configureServer(server) {
        server.middlewares.use(serveFixture)
      },
    },
  ],
})
function serveFixture(request, response, next) {
  if (request.url !== '/') return next()
  response.setHeader('Content-Type', 'text/html')
  response.end(
    '<!doctype html><html lang="en"><title>Reading order proof</title><body><script type="module" src="/packages/markdown/test/reading-order.fixture.ts"></script></body></html>',
  )
}
let browser
try {
  await server.listen()
  browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1024, height: 640 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${values.port}`)
  await page.waitForFunction(() => Boolean(window.readingProof))
  const before = await page.locator('body').ariaSnapshot()
  await writeFile(resolve(output, 'aria-before.yaml'), before)
  assert.equal(await page.getByRole('heading').count(), 9)
  await page.evaluate(() => window.readingProof.takeover())
  await page.getByRole('link', { name: 'link 1', exact: true }).waitFor()
  const after = await page.locator('main').ariaSnapshot()
  await writeFile(resolve(output, 'aria-after.yaml'), after)
  await page.screenshot({ path: resolve(output, 'takeover.png') })
  const headings = await page.getByRole('heading').count()
  const links = await page.locator('main').getByRole('link').count()
  if (!values.baseline) {
    assert.equal(headings, 9)
    assert.equal(links, 9)
    for (let index = 0; index < 9; index++) {
      await page
        .getByRole('heading', { name: `Section ${index + 1}`, exact: true, level: (index % 6) + 1 })
        .waitFor()
      assert(after.indexOf(`Section ${index + 1}`) < after.indexOf(`link ${index + 1}`))
      if (index < 8)
        assert(after.indexOf(`link ${index + 1}`) < after.indexOf(`Section ${index + 2}`))
    }
  }
  if (!values.baseline) {
    await page.evaluate(() =>
      window.readingProof.loadMarkdown(
        'First **line**\nsecond [line](https://example.com)\n===========\nplain',
        false,
      ),
    )
    await page.getByRole('heading', { name: 'First line second line', exact: true }).waitFor()
    await writeFile(
      resolve(output, 'aria-multiline.yaml'),
      await page.locator('main').ariaSnapshot(),
    )
    await page.screenshot({ path: resolve(output, 'multiline-heading.png') })
    const title = 'Start ' + 'long title '.repeat(80) + 'END'
    await page.evaluate(
      (title) => window.readingProof.loadMarkdown('# ' + title + '\nplain', true),
      title,
    )
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    assert.equal(await page.getByRole('heading').count(), 1)
    await writeFile(resolve(output, 'aria-wrapped.yaml'), await page.locator('main').ariaSnapshot())
    await page.screenshot({ path: resolve(output, 'wrapped-heading.png') })
  }
  await page.evaluate(
    (text) => window.readingProof.loadPlain(text),
    Array.from({ length: 200 }, (_, index) => `Reading row ${String(index).padStart(3, '0')}`).join(
      '\n',
    ),
  )
  const orders = []
  for (const top of [0, 20, 80, 400, 380, 60, 0]) {
    await page.evaluate((top) => window.readingProof.scroll(top), top)
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)))
    const rows = await page
      .locator('[data-editor-virtual-row]')
      .evaluateAll((rows) => rows.map((row) => Number(row.dataset.editorVirtualRow)))
    orders.push(rows)
    const reading = await page.locator('main').ariaSnapshot()
    await writeFile(resolve(output, `aria-scroll-${orders.length}.yaml`), reading)
    if (values.baseline || values['headings-only']) continue
    assert.deepEqual(
      rows,
      [...rows].sort((a, b) => a - b),
    )
    let previous = -1
    for (const row of rows) {
      const position = reading.indexOf(`Reading row ${String(row).padStart(3, '0')}`)
      assert(position > previous, `Accessible row ${row} follows the previous row`)
      previous = position
    }
  }
  await page.evaluate((text) => window.readingProof.loadPlain(text), fixture(1))
  const samples = []
  for (let repetition = 0; repetition < 3; repetition++) {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Tracing.start', {
      categories: 'devtools.timeline,blink.user_timing',
      transferMode: 'ReturnAsStream',
    })
    const completed = new Promise((done) => cdp.once('Tracing.tracingComplete', done))
    await page.evaluate(() => window.readingProof.frames(120))
    await cdp.send('Tracing.end')
    const { stream } = await completed
    let data = ''
    while (true) {
      const chunk = await cdp.send('IO.read', { handle: stream })
      data += chunk.data
      if (chunk.eof) break
    }
    await cdp.send('IO.close', { handle: stream })
    await cdp.detach()
    await writeFile(resolve(output, `scroll-${repetition}.trace.json`), data)
    const events = JSON.parse(data).traceEvents
    const marker = events.find((event) => event.name === 'reading-scroll-start')
    const frames = events
      .filter((event) => event.name === 'reading-scroll-frame')
      .map((event) => event.ts)
    const costs = scrollCosts(events, frames, marker)
    assert.equal(costs.ms.n, 120)
    samples.push(...costs.samplesMs)
  }
  assert.deepEqual(errors, [])
  const result = {
    experiment: true,
    condition: values.condition,
    date: new Date().toISOString(),
    machine: { platform: process.platform, release: release(), cpu: cpus()[0]?.model },
    runtime: process.version,
    method: { fixtureMiB: 1, repetitions: 3, framesPerRepetition: 120, pixelsPerFrame: 200 },
    browser: browser.version(),
    headings,
    links,
    orders,
    renderingMs: summarize(samples),
    samplesMs: samples,
  }
  if (values.compare) {
    const baseline = JSON.parse(await readFile(resolve(values.compare, 'result.json'), 'utf8'))
    result.comparison = {
      before: baseline.renderingMs,
      p50Ratio: result.renderingMs.p50 / baseline.renderingMs.p50,
      p95Ratio: result.renderingMs.p95 / baseline.renderingMs.p95,
    }
  }
  await writeFile(resolve(output, 'result.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify({ ...result, orders: undefined, samplesMs: undefined }))
} finally {
  await browser?.close()
  await server.close()
}
