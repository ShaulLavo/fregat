import { readFile, writeFile, mkdir, stat, readdir } from 'node:fs/promises'
import { dirname, extname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parseArgs } from 'node:util'
import { build } from 'vite'
import { chromium } from '@playwright/test'
import { fail } from '../../../examples/stress/errors.mjs'

const bench = dirname(fileURLToPath(import.meta.url))
const repository = resolve(bench, '../../..')
const { values } = parseArgs({
  options: {
    label: { type: 'string', default: 'before' },
    origin: { type: 'string', default: 'http://127.0.0.1:3300' },
    'output-dir': { type: 'string', default: '/work/tmp/minimap-benchmark' },
    steps: { type: 'string', default: '120' },
    'minimap-root': { type: 'string', default: resolve(bench, '..') },
    'visual-only': { type: 'boolean', default: false },
    'pixels-only': { type: 'boolean', default: false },
    'timing-only': { type: 'boolean', default: false },
    'build-root': { type: 'string' },
    trials: { type: 'string', default: '3' },
    'all-motions': { type: 'boolean', default: false },
    'visual-step': { type: 'string', default: '120' },
    'visual-tokens': { type: 'string', default: '1' },
    uncapped: { type: 'boolean', default: false },
    scenario: { type: 'string' },
  },
})
const output = resolve(values['output-dir'])
for (const option of ['steps', 'trials']) {
  if (!Number.isInteger(Number(values[option])) || Number(values[option]) <= 0)
    fail(`--${option} must be a positive integer`)
}
const directory = values['build-root']
  ? resolve(values['build-root'])
  : resolve(output, `${values.label}-build`)
await mkdir(output, { recursive: true })
const aliases = await sourceAliases()
aliases.unshift({
  find: /^\.\.\/src\/(index|workerClient)$/,
  replacement: `${resolve(values['minimap-root'], 'src')}/$1.ts`,
})
if (!values['build-root'])
  await build({
    root: resolve(bench, 'browser'),
    configFile: false,
    logLevel: 'warn',
    resolve: { alias: aliases },
    worker: { format: 'es' },
    build: { outDir: directory, emptyOutDir: true, minify: false, sourcemap: true },
  })
const browser = await chromium.launch({
  headless: true,
  env: { ...process.env, TMPDIR: output },
  args: values.uncapped ? ['--disable-frame-rate-limit', '--disable-gpu-vsync'] : [],
})
const result = {
  label: values.label,
  origin: values.origin,
  at: new Date().toISOString(),
  browser: browser.version(),
  source: await bundleProof(),
  fixture: {
    lines: 20_000,
    viewport: { width: 1040, height: 740 },
    deviceScaleFactor: 1,
    steps: Number(values.steps),
    uncapped: values.uncapped,
  },
  samples: [],
  visual: null,
  pixels: null,
  wheel: null,
}

async function bundleProof() {
  const assets = await readdir(resolve(directory, 'assets'))
  const files = []
  for (const name of assets.filter((name) => name.endsWith('.js')).sort()) {
    const bytes = await readFile(resolve(directory, 'assets', name))
    files.push({ file: name, sha256: createHash('sha256').update(bytes).digest('hex') })
  }
  return { minimapRoot: resolve(values['minimap-root']), build: directory, files }
}
try {
  for (const scenario of timingScenarios()) {
    const sample = await measure(browser, scenario)
    result.samples.push(sample)
    console.log(JSON.stringify({ progress: summarize(sample) }))
  }
  if (values['pixels-only']) result.pixels = await pixelOracle(browser)
  if (!values['pixels-only'] && !values['timing-only']) result.visual = await visualSample(browser)
  if (!values['pixels-only'] && !values['timing-only']) result.wheel = await wheelSmoke(browser)
  await writeFile(resolve(output, `${values.label}.json`), JSON.stringify(result, null, 2))
  console.log(
    JSON.stringify({
      output: resolve(output, `${values.label}.json`),
      timingSamples: result.samples.length,
      pixels: result.pixels,
      wheel: result.wheel,
      visual: result.visual?.pixelSummary && {
        framesDuringScroll: result.visual.pixelSummary.framesDuringScroll,
        framesWithCodeMotion: result.visual.pixelSummary.framesWithCodeMotion,
        framesWithEditorMotion: result.visual.pixelSummary.framesWithEditorMotion,
        maxCodeFreezeMs: result.visual.pixelSummary.maxCodeFreezeMs,
      },
    }),
  )
} finally {
  await browser.close()
}

function timingScenarios() {
  if (values['visual-only'] || values['pixels-only']) return []
  const steps = Number(values.steps)
  const configurations = [
    { name: 'fast-control', minimap: false, tokenEvery: 0, stepPx: 120, steps },
    { name: 'fast-scroll', minimap: true, tokenEvery: 0, stepPx: 120, steps },
    { name: 'fast-tokens', minimap: true, tokenEvery: 1, stepPx: 120, steps },
  ]
  if (values['all-motions'] || values.scenario)
    configurations.push(
      { name: 'slow-scroll', minimap: true, tokenEvery: 0, stepPx: 2, steps },
      { name: 'slow-tokens', minimap: true, tokenEvery: 1, stepPx: 2, steps },
      { name: 'reverse', minimap: true, tokenEvery: 0, stepPx: -120, steps: 40 },
      { name: 'large-jumps', minimap: true, tokenEvery: 0, stepPx: 12000, steps: 24 },
    )
  const selected = values.scenario
    ? configurations.filter((scenario) => scenario.name === values.scenario)
    : configurations
  if (selected.length === 0) fail(`Unknown scenario: ${values.scenario}`)
  return Array.from({ length: Number(values.trials) }, (_, trial) =>
    selected.map((scenario) => ({ ...scenario, trial: trial + 1 })),
  ).flat()
}

async function pixelOracle(browser) {
  const { page, context } = await createPage(browser, false)
  try {
    return await page.evaluate(() => globalThis.__minimapBench.pixels())
  } finally {
    await context.close()
  }
}

async function wheelSmoke(browser) {
  const { page, context } = await createPage(browser, true)
  try {
    await page.evaluate(() => globalThis.__minimapBench.scroll(6000))
    await page.waitForTimeout(200)
    const before = await page
      .locator('.editor-virtualized')
      .evaluate((element) => element.scrollTop)
    await page.mouse.move(400, 350)
    await page.mouse.wheel(0, 480)
    await page.waitForFunction(
      (top) => document.querySelector('.editor-virtualized').scrollTop > top,
      before,
    )
    await page.waitForTimeout(300)
    const after = await page.locator('.editor-virtualized').evaluate((element) => element.scrollTop)
    const received = await page.evaluate(
      (top) =>
        globalThis.__minimapWire.filter(
          (event) => event.type === 'updateViewport' && event.scrollTop > top,
        ).length,
      before,
    )
    if (received === 0) fail('Native wheel scroll did not reach the minimap worker')
    return { before, after, viewportMessages: received }
  } finally {
    await context.close()
  }
}

async function sourceAliases() {
  const core = resolve(repository, 'packages/editor')
  const manifest = JSON.parse(await readFile(resolve(core, 'package.json'), 'utf8'))
  const aliases = []
  for (const [subpath, value] of Object.entries(manifest.exports)) {
    const target = typeof value === 'string' ? value : value.import
    let source = resolve(core, target.replace('./dist/', './src/').replace(/\.js$/, '.ts'))
    if (!(await stat(source).catch(() => null))?.isFile())
      source = source.replace(/\.ts$/, '/index.ts')
    aliases.push({
      find: `@singapore-editor/core${subpath === '.' ? '' : subpath.slice(1)}`,
      replacement: source,
    })
  }
  return aliases.sort((left, right) => right.find.length - left.find.length)
}

async function routeAsset(route) {
  const url = new URL(route.request().url())
  const path = resolve(
    directory,
    `.${url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)}`,
  )
  if (!path.startsWith(directory + sep)) return route.abort()
  const contentType =
    {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.map': 'application/json',
    }[extname(path)] ?? 'application/octet-stream'
  const body = await readFile(path).catch(() => null)
  if (!body) return route.abort()
  await route.fulfill({ body, contentType })
}

async function createPage(browser, minimap) {
  const context = await browser.newContext({
    viewport: { width: 1040, height: 740 },
    deviceScaleFactor: 1,
    serviceWorkers: 'block',
  })
  await context.route('**/*', routeAsset)
  await context.addInitScript(installMainProbe)
  const page = await context.newPage()
  page.on('pageerror', (error) => console.error(error.message))
  await page.goto(`${values.origin}/`, { waitUntil: 'networkidle' })
  await page.evaluate((enabled) => globalThis.__minimapBench.prepare(enabled), minimap)
  if (minimap)
    await page.waitForFunction(() =>
      globalThis.__minimapWire.some((event) => event.type === 'rendered'),
    )
  await page.waitForTimeout(500)
  const worker = page.workers().find((candidate) => candidate.url().includes('minimap.worker'))
  if (minimap && !worker) fail('Missing real minimap worker')
  if (worker) await worker.evaluate(installWorkerProbe)
  const clock = worker ? await page.evaluate(calibrateClock) : null
  return { page, context, worker, clock }
}

async function calibrateClock() {
  const samples = []
  for (let index = 0; index < 20; index++) samples.push(await globalThis.__minimapClockPing())
  const best = samples.toSorted((left, right) => left.roundTripMs - right.roundTripMs)[0]
  return { workerOffsetMs: best.workerOffsetMs, uncertaintyMs: best.roundTripMs / 2 + 0.1, samples }
}

function installMainProbe() {
  globalThis.__minimapWire = []
  const minimapWorkers = []
  globalThis.__minimapClockPing = () => {
    const pending = Promise.withResolvers()
    const worker = minimapWorkers[0]
    const sent = performance.timeOrigin + performance.now()
    const receive = (event) => {
      if (event.data.__minimapClockReply !== sent) return
      const received = performance.timeOrigin + performance.now()
      worker.removeEventListener('message', receive)
      pending.resolve({
        roundTripMs: received - sent,
        workerOffsetMs: event.data.workerAt - (sent + received) / 2,
      })
    }
    worker.addEventListener('message', receive)
    worker.postMessage({ __minimapClock: sent })
    return pending.promise
  }
  let nextId = 0
  const NativeWorker = globalThis.Worker
  globalThis.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options)
      this.minimapProbe = String(url).includes('minimap.worker')
      if (this.minimapProbe) minimapWorkers.push(this)
      if (this.minimapProbe)
        this.addEventListener('message', (event) =>
          globalThis.__minimapWire.push({
            at: performance.timeOrigin + performance.now(),
            direction: 'receive',
            ...event.data,
          }),
        )
    }
    postMessage(request, ...rest) {
      if (!this.minimapProbe) return super.postMessage(request, ...rest)
      const id = ++nextId
      const at = performance.timeOrigin + performance.now()
      super.postMessage({ ...request, __benchId: id }, ...rest)
      globalThis.__minimapWire.push({
        direction: 'send',
        id,
        at,
        durationMs: performance.timeOrigin + performance.now() - at,
        type: request.type,
        scrollTop: request.viewport?.scrollTop,
        sequence: request.sequence,
      })
    }
  }
}

function installWorkerProbe() {
  globalThis.__minimapWorker = []
  const original = globalThis.onmessage
  let viewport = null
  let request = null
  let painted = 0
  let uploads = 0
  let copies = 0
  const putImageData = OffscreenCanvasRenderingContext2D.prototype.putImageData
  const drawImage = OffscreenCanvasRenderingContext2D.prototype.drawImage
  OffscreenCanvasRenderingContext2D.prototype.putImageData = function (...args) {
    painted++
    uploads++
    return putImageData.apply(this, args)
  }
  OffscreenCanvasRenderingContext2D.prototype.drawImage = function (...args) {
    painted++
    copies++
    return drawImage.apply(this, args)
  }
  globalThis.__EDITOR_PERFORMANCE_DIAGNOSTICS__ = (diagnostic) =>
    globalThis.__minimapWorker.push({
      phase: 'diagnostic',
      ...diagnostic,
      id: request?.__benchId,
      at: performance.timeOrigin + performance.now(),
    })
  globalThis.onmessage = function (event) {
    if (typeof event.data.__minimapClock === 'number') {
      globalThis.postMessage({
        __minimapClockReply: event.data.__minimapClock,
        workerAt: performance.timeOrigin + performance.now(),
      })
      return
    }
    request = event.data
    if (request.viewport) viewport = request.viewport
    const at = performance.timeOrigin + performance.now()
    const before = painted
    const beforeUploads = uploads
    const beforeCopies = copies
    original.call(this, event)
    globalThis.__minimapWorker.push({
      phase: 'handled',
      type: request.type,
      id: request.__benchId,
      sequence: request.sequence,
      scrollTop: viewport?.scrollTop,
      at,
      durationMs: performance.timeOrigin + performance.now() - at,
      paints: painted - before,
      rasterUploads: uploads - beforeUploads,
      canvasCopies: copies - beforeCopies,
    })
  }
}

async function measure(browser, scenario) {
  const { page, context, worker, clock } = await createPage(browser, scenario.minimap)
  try {
    await page.evaluate(() => {
      globalThis.__minimapWire.length = 0
      globalThis.__minimapBench.reset()
    })
    const report = await page.evaluate((options) => globalThis.__minimapBench.run(options), {
      steps: scenario.steps,
      stepPx: scenario.stepPx,
      tokenEvery: scenario.tokenEvery,
    })
    await page.waitForTimeout(500)
    const wire = await page.evaluate(() => globalThis.__minimapWire)
    const workerEvents = worker ? await worker.evaluate(() => globalThis.__minimapWorker) : []
    return { ...scenario, ...report, wire, workerEvents, clock }
  } finally {
    await context.close()
  }
}

async function visualSample(browser) {
  const { page, context } = await createPage(browser, true)
  const cdp = await context.newCDPSession(page)
  const frames = []
  const captures = []
  cdp.on('Page.screencastFrame', (event) => {
    captures.push({ data: event.data, timestamp: event.metadata.timestamp })
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
  })
  try {
    await page.evaluate(() => globalThis.__minimapBench.scroll(6000))
    await page.addStyleTag({ content: '.editor-minimap-slider { visibility: hidden !important; }' })
    await page.waitForTimeout(500)
    const lane = await page.locator('.editor-minimap').boundingBox()
    await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
    const report = await page.evaluate((options) => globalThis.__minimapBench.run(options), {
      steps: 40,
      stepPx: Number(values['visual-step']),
      tokenEvery: Number(values['visual-tokens']),
    })
    await page.waitForTimeout(500)
    await cdp.send('Page.stopScreencast')
    const pixelSummary = await page.evaluate(analyzePixels, {
      captures,
      lane,
      inputs: report.inputs,
    })
    const visualDirectory = resolve(output, `${values.label}-visual`)
    await mkdir(visualDirectory, { recursive: true })
    for (const [index, capture] of captures.entries()) {
      const name = `${String(index).padStart(4, '0')}.png`
      const bytes = Buffer.from(capture.data, 'base64')
      await writeFile(resolve(visualDirectory, name), bytes)
      frames.push({
        file: name,
        timestamp: capture.timestamp,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      })
    }
    return {
      directory: visualDirectory,
      lane,
      inputs: report.inputs,
      frames,
      pixelSummary,
      note: 'Screenshots are a separate instrumented run, with slider hidden to isolate code pixels. These frame-swap images prove pixels; worker ACK timestamps do not.',
    }
  } finally {
    await context.close()
  }
}

async function analyzePixels({ captures, lane, inputs }) {
  if (!lane || captures.length === 0) return { error: 'No visible minimap frames' }
  const x = Math.ceil(lane.x + 16)
  const y = Math.ceil(lane.y + 2)
  const width = Math.floor(lane.width - 20)
  const height = Math.floor(lane.height - 4)
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const controlCanvas = new OffscreenCanvas(100, height)
  const controlContext = controlCanvas.getContext('2d', { willReadFrequently: true })
  const samples = []
  let previous = null
  let previousControl = null
  for (const capture of captures) {
    const binary = atob(capture.data)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    context.drawImage(bitmap, x, y, width, height, 0, 0, width, height)
    controlContext.drawImage(bitmap, 16, y, 100, height, 0, 0, 100, height)
    bitmap.close()
    const pixels = context.getImageData(0, 0, width, height).data
    const current = Uint8Array.from({ length: width * height }, (_, index) => pixels[index * 4])
    const changed = previous
      ? current.reduce((count, pixel, index) => count + Number(pixel !== previous[index]), 0)
      : 0
    const controlPixels = controlContext.getImageData(0, 0, 100, height).data
    const control = Uint8Array.from(
      { length: 100 * height },
      (_, index) => controlPixels[index * 4],
    )
    const controlChanged = previousControl
      ? control.reduce((count, pixel, index) => count + Number(pixel !== previousControl[index]), 0)
      : 0
    samples.push({
      at: capture.timestamp * 1000,
      changedPixels: changed,
      editorChangedPixels: controlChanged,
    })
    previous = current
    previousControl = control
  }
  const start = inputs[1]?.at ?? inputs[0].at
  const end = inputs.at(-1).at
  const active = samples.filter((sample) => sample.at >= start && sample.at <= end + 30)
  const changes = active.filter((sample) => sample.changedPixels > 50)
  const boundaries = [start, ...changes.map((sample) => sample.at), end]
  const gaps = boundaries.slice(1).map((at, index) => Math.max(0, at - boundaries[index]))
  return {
    framesDuringScroll: active.length,
    framesWithCodeMotion: changes.length,
    framesWithEditorMotion: active.filter((sample) => sample.editorChangedPixels > 50).length,
    maxCodeFreezeMs: Math.max(...gaps),
    samples,
  }
}

function summarize(sample) {
  const renders = sample.workerEvents.filter(
    (event) => event.phase === 'handled' && event.type === 'render',
  )
  const sent = new Map(
    sample.wire.filter((event) => event.direction === 'send').map((event) => [event.id, event]),
  )
  const waits = sample.workerEvents
    .filter((event) => event.phase === 'handled' && sent.has(event.id))
    .map((event) => event.at - (sample.clock?.workerOffsetMs ?? 0) - sent.get(event.id).at)
  const paints = renders.filter((event) => event.paints > 0)
  const gaps = paints.slice(1).map((event, index) => event.at - paints[index].at)
  const activePaints = paints.filter(
    (event) => event.at >= sample.inputs[0].at && event.at <= sample.inputs.at(-1).at + 20,
  )
  const activeGaps = activePaints.slice(1).map((event, index) => event.at - activePaints[index].at)
  return {
    name: sample.name,
    trial: sample.trial,
    minimap: sample.minimap,
    tokenEvery: sample.tokenEvery,
    frame: distribution(sample.frames),
    input: distribution(sample.inputs.map((event) => event.durationMs)),
    update: distribution(sample.updates.map((event) => event.durationMs)),
    renders: renders.length,
    paints: paints.length,
    activePaints: activePaints.length,
    workerRender: distribution(renders.map((event) => event.durationMs)),
    postToWorker: distribution(waits),
    crossClockUncertaintyMs: sample.clock?.uncertaintyMs ?? null,
    paintGap: distribution(gaps),
    activePaintGap: distribution(activeGaps),
  }
}

function distribution(values) {
  if (values.length === 0) return null
  const sorted = values.toSorted((a, b) => a - b)
  return {
    count: values.length,
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
    p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
    max: sorted.at(-1),
  }
}
