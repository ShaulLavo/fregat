import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'

const dist = new URL('../../packages/textbuffer/dist/', import.meta.url)
const server = createServer((request, response) => {
  serve(request.url, response).catch(() => {
    response.writeHead(404)
    response.end()
  })
})

async function serve(url, response) {
  if (url === '/') {
    response.setHeader('content-type', 'text/html')
    response.end('<!doctype html><title>Text reclamation measurement</title>')
    return
  }
  assert.match(url, /^\/[\w-]+\.js$/)
  const content = await readFile(new URL(url.slice(1), dist))
  response.setHeader('content-type', 'text/javascript')
  response.end(content)
}

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
assert.ok(address && typeof address === 'object')
const browser = await chromium.launch({ headless: true })

async function sample(mode, cycles) {
  const context = await browser.newContext()
  try {
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:${address.port}`)
    const cdp = await context.newCDPSession(page)
    await page.evaluate(initialize)
    const before = await heap(cdp)
    const result = await page.evaluate(run, { mode, cycles })
    const withPins = (await heap(cdp)) - before
    await page.evaluate(() => {
      window.reclamation.pinned.length = 0
    })
    const afterRelease = (await heap(cdp)) - before
    return { mode, cycles, ...result, heapWithPins: withPins, heapAfterRelease: afterRelease }
  } finally {
    await context.close()
  }
}

async function heap(cdp) {
  await cdp.send('HeapProfiler.collectGarbage')
  return (await cdp.send('Runtime.getHeapUsage')).usedSize
}

async function initialize() {
  window.reclamation = {
    api: await import(new URL('/index.js', location.origin).href),
    maintenance: await import(new URL('/reclamation.js', location.origin).href),
    debug: await import(new URL('/debug.js', location.origin).href),
    pinned: [],
    current: null,
  }
}

function run({ mode, cycles }) {
  const state = window.reclamation
  const api = state.api
  let current = api.createPieceTableSnapshot('prefix suffix')
  const pauses = []
  const pins = []
  for (let cycle = 0; cycle < cycles; cycle++) {
    const payload = `${cycle.toString().padStart(8, '0')}${'x'.repeat(1015)}\n`
    current = api.insertIntoPieceTable(current, 7, payload)
    if (cycle % 100 === 0) pins.push(current)
    current = api.deleteFromPieceTable(current, 7, payload.length)
    if (mode !== 'reclaim' || (cycle + 1) % 250 !== 0) continue
    const start = performance.now()
    current = state.maintenance.reclaimPieceTableText(current)
    pauses.push(performance.now() - start)
  }
  const retainedTextValid = pins.every(
    (snapshot, index) =>
      api.materializePieceTableFullText(snapshot) ===
      `prefix ${(index * 100).toString().padStart(8, '0')}${'x'.repeat(1015)}\nsuffix`,
  )
  state.current = current
  state.pinned = pins
  return {
    liveText: api.materializePieceTableFullText(current),
    retainedTextValid,
    nodes: current.pieceCount,
    pins: pins.length,
    issues: state.debug.validatePieceTreeInvariants(current).issues,
    maxMaintenanceMs: Math.max(0, ...pauses),
  }
}

try {
  const samples = []
  for (const cycles of [5000, 10000]) {
    samples.push(await sample('control', cycles))
    samples.push(await sample('reclaim', cycles))
  }
  for (const result of samples) {
    assert.equal(result.liveText, 'prefix suffix')
    assert.equal(result.retainedTextValid, true)
    assert.deepEqual(result.issues, [])
  }
  console.log(
    JSON.stringify(
      {
        browser: browser.version(),
        measuredAt: new Date().toISOString(),
        note: 'Chromium storage benchmark. Explicit CDP GC; old snapshots held then released. No mounted editor or typing-to-paint claim. Timing uses the browser clock and is advisory.',
        samples,
      },
      null,
      2,
    ),
  )
} finally {
  await browser.close()
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
}
