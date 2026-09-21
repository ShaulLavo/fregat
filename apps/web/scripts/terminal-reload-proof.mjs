import { chromium } from 'playwright'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { parseArgs } from 'node:util'
import { selectors, waitForApp, runPaletteCommand } from '../../../scripts/agent/selectors.ts'
import { createBenchmarkError } from './structured-errors.mjs'

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: 'http://localhost:5173/' },
    output: { type: 'string', default: '/work/tmp/platform-instaload/all-slices/terminal' },
    check: { type: 'boolean', default: false },
    width: { type: 'string', default: '1440' },
    height: { type: 'string', default: '900' },
  },
})
const targetUrl = new URL(values.url)
const baseUrl = new URL(targetUrl)
baseUrl.pathname = `${targetUrl.pathname.split('/~')[0].replace(/\/$/, '')}/`
baseUrl.search = ''
baseUrl.hash = ''
const apiUrl = targetUrl.port === '5173' ? new URL('/', targetUrl) : new URL('api/', baseUrl)
if (targetUrl.port === '5173') apiUrl.port = '3001'
const api = apiUrl.href
const viewport = { width: Number(values.width), height: Number(values.height) }
if (
  !Number.isInteger(viewport.width) ||
  !Number.isInteger(viewport.height) ||
  viewport.width < 320 ||
  viewport.height < 300 ||
  viewport.width > 7680 ||
  viewport.height > 4320
)
  throw createBenchmarkError('Viewport must be integer dimensions between 320×300 and 7680×4320')
const output = values.output
await mkdir(`${output}/filmstrip`, { recursive: true })
const prefix = `reload-proof-${randomUUID()}-`
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport })
const page = await context.newPage()
page.setDefaultTimeout(20000)
const errors = []
const exceptions = []
const cdp = await context.newCDPSession(page)
await cdp.send('Runtime.enable')
cdp.on('Runtime.exceptionThrown', (event) => exceptions.push(event.exceptionDetails))
const owners = new Map()
const connections = []
let proofPhase = 'bootstrap'
let withholding = false
let releaseMessages = []
let film = []
let navigationSeen = false
let result = { completed: false, prefix }
page.on('pageerror', (error) =>
  errors.push({
    phase: proofPhase,
    terminalConnections: connections.length,
    message: error.message,
    stack: error.stack,
  }),
)
// Routed Playwright sockets can deliver queued messages after their native socket closed.
await page.addInitScript(() => {
  window.__terminalProofDiscardedMessages = []
  function suppressClosedMockDelivery(Socket) {
    const deliver = Socket.prototype._apiSendToPage
    if (typeof deliver !== 'function') return Socket
    Socket.prototype._apiSendToPage = function (message) {
      if (this.readyState === Socket.CLOSING || this.readyState === Socket.CLOSED) {
        window.__terminalProofDiscardedMessages.push(this.url)
        return
      }
      return deliver.call(this, message)
    }
    return Socket
  }
  let Socket = suppressClosedMockDelivery(window.WebSocket)
  Object.defineProperty(window, 'WebSocket', {
    configurable: true,
    get: () => Socket,
    set: (value) => {
      Socket = suppressClosedMockDelivery(value)
    },
  })
})
await page.addInitScript(() => {
  window.__terminalReloadFrames = []
  const frame = () => {
    const pane = document.querySelector('[data-slot="tool-pane"][aria-label="Terminal"]')
    const saved = pane?.querySelector('[data-terminal-presentation="saved"] canvas')
    const live = pane?.querySelector('canvas')
    window.__terminalReloadFrames.push({
      time: performance.now(),
      shell: Boolean(document.querySelector('[aria-label="Window toolbar"]')),
      pane: Boolean(pane),
      saved: Boolean(saved),
      canvas: Boolean(live),
      inert: Boolean(pane?.querySelector('[inert]')),
    })
    if (window.__terminalReloadFrames.length < 900) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
})
await page.routeWebSocket(/\/terminal\?/, (socket) => {
  const url = new URL(socket.url())
  const logicalId = url.searchParams.get('terminalId')
  const terminalId = logicalId?.startsWith(prefix) ? logicalId : `${prefix}${logicalId}`
  url.searchParams.set('terminalId', terminalId)
  const worktreeId = url.searchParams.get('worktreeId')
  if (
    !logicalId ||
    !terminalId.startsWith(prefix) ||
    !worktreeId ||
    url.searchParams.has('agentSessionId')
  )
    throw createBenchmarkError('Proof attempted an unowned terminal connection')
  owners.set(`${worktreeId}:${terminalId}`, { worktreeId, terminalId })
  const connection = { url: url.href, received: [], sent: [], held: 0 }
  connections.push(connection)
  const server = new WebSocket(url, { headers: { Origin: new URL(values.url).origin } })
  server.binaryType = 'arraybuffer'
  const pending = []
  server.addEventListener('open', () => {
    for (const message of pending.splice(0)) server.send(message)
  })
  socket.onMessage((message) => {
    connection.sent.push(describeMessage(message))
    if (server.readyState === WebSocket.OPEN) server.send(message)
    else pending.push(message)
  })
  socket.onClose(() => server.close())
  server.addEventListener('close', (event) => {
    connection.close = { code: event.code, reason: event.reason }
    void socket.close()
  })
  server.addEventListener('message', (event) => {
    const message = typeof event.data === 'string' ? event.data : Buffer.from(event.data)
    connection.received.push(describeMessage(message))
    if (!withholding) {
      socket.send(message)
      return
    }
    connection.held++
    releaseMessages.push(() => socket.send(message))
  })
})
try {
  const release = await page.request.get(`${api}release`).then((response) => response.json())
  const registration = await page.request.post(`${api}fs/workspace-address`, {
    data: { path: 'work/projects/platform' },
    headers: { Origin: new URL(values.url).origin },
  })
  if (!registration.ok()) throw createBenchmarkError('Workspace registration failed')
  const workspace = await registration.json()
  await page.goto(
    targetUrl.pathname.includes('/~')
      ? targetUrl.href
      : `${baseUrl.href}~${encodeURIComponent(`${workspace.name}.${workspace.id}`)}/workbench`,
  )
  await waitForApp(page)
  await runPaletteCommand(page, 'Show terminal')
  const pane = selectors.terminalSurface(page).first()
  await pane.waitFor()
  await until(
    () =>
      page.evaluate(() =>
        Boolean(
          !document
            .querySelector('[aria-label="Terminal"] textarea:not([disabled])')
            ?.closest('[inert]') && document.querySelector('[aria-label="Terminal"] textarea'),
        ),
      ),
    'Terminal must become ready',
  )
  await page.waitForTimeout(500)
  const empty = await page.screenshot({ path: `${output}/empty.png` })
  const marker = `WARM_${randomUUID().slice(0, 8)}`
  const command = `awk 'BEGIN { printf "\\033[2J\\033[H"; for (i=0;i<80;i++) printf "\\033[44;97m${marker}_%03d colored native terminal output\\033[0m\\r\\n", i; exit }'`
  await pane.click({ position: { x: 100, y: 70 } })
  await page.keyboard.type(command)
  await page.keyboard.press('Enter')
  await until(
    async () =>
      (await cacheRecord())?.paint.includes(marker[0]) &&
      connections
        .at(-1)
        ?.received.some(
          (message) => message.kind === 'output' && message.text.includes(`${marker}_079`),
        ),
    'Proof output must reach the native terminal',
  )
  await page.waitForTimeout(600)
  await pane.hover({ position: { x: 140, y: 90 } })
  await page.mouse.wheel(0, -420)
  await page.mouse.move(10, 10)
  await until(async () => {
    const cache = await cacheRecord()
    if (!cache) return false
    const paint = JSON.parse(cache.paint)
    return paint.scrollbar.offset < paint.scrollbar.total - paint.scrollbar.length
  }, 'Terminal must scroll away from the live bottom')
  await page.waitForTimeout(1200)
  const before = await inspect()
  const control = await page.screenshot({ path: `${output}/control.png` })
  const rectangle = await pane.locator('canvas').first().boundingBox()
  if (!rectangle) throw createBenchmarkError('Native terminal canvas is missing')
  const region = {
    x: Math.ceil(rectangle.x),
    y: Math.ceil(rectangle.y),
    width: Math.min(Math.floor(rectangle.width), viewport.width - Math.ceil(rectangle.x)),
    height: Math.min(Math.floor(rectangle.height), viewport.height - Math.ceil(rectangle.y)),
  }
  const calibration = await compare(empty, control, region)
  cdp.on('Page.frameNavigated', (event) => {
    if (!event.frame.parentId) navigationSeen = true
  })
  cdp.on('Page.screencastFrame', (event) => {
    void cdp.send('Page.screencastFrameAck', { sessionId: event.sessionId })
    if (!navigationSeen || film.length > 100) return
    film.push({ data: event.data, timestamp: event.metadata.timestamp })
  })
  await cdp.send('Page.enable')
  await cdp.send('Page.startScreencast', {
    format: 'png',
    maxWidth: viewport.width,
    maxHeight: viewport.height,
    everyNthFrame: 1,
  })
  proofPhase = 'reload'
  withholding = true
  await page.reload({ waitUntil: 'commit' })
  await waitForApp(page)
  await page.waitForTimeout(1500)
  const held = await inspect()
  const heldPng = await page.screenshot({ path: `${output}/held.png` })
  const heldMatch = await compare(control, heldPng, region)
  const heldCount = releaseMessages.length
  const beforeBlockedInput = connections.at(-1)?.sent.length ?? 0
  await selectors
    .terminalSurface(page)
    .first()
    .click({ position: { x: 140, y: 60 } })
  await page.keyboard.type('INPUT_MUST_NOT_REACH_PTY')
  await page.waitForTimeout(100)
  const blockedInput = (connections.at(-1)?.sent.length ?? 0) === beforeBlockedInput
  const heldFrames = await page.evaluate(() => window.__terminalReloadFrames)
  proofPhase = 'handoff'
  withholding = false
  for (const send of releaseMessages.splice(0)) send()
  await until(
    async () => !(await inspect()).inert && !(await inspect()).saved,
    'Replay must hand off after native paint',
  )
  await page.waitForTimeout(700)
  const live = await inspect()
  const livePng = await page.screenshot({ path: `${output}/live.png` })
  const liveMatch = await compare(control, livePng, region)
  await cdp.send('Page.stopScreencast')
  const frames = []
  for (const [index, frame] of film.entries()) {
    const bytes = Buffer.from(frame.data, 'base64')
    await writeFile(`${output}/filmstrip/${String(index).padStart(3, '0')}.png`, bytes)
    frames.push({
      index,
      timestamp: frame.timestamp,
      ...(await compare(control, bytes, region)),
      shell: await compare(control, bytes, { x: 14, y: 4, width: 70, height: 25 }),
    })
  }
  const firstPane = heldFrames.find((frame) => frame.pane)
  const navigationBlank = frames.findIndex((frame) => frame.shell.changedFraction > 0.1)
  const firstContentCompositor = frames
    .slice(navigationBlank + 1)
    .find((frame) => frame.shell.changedFraction < 0.05)
  const noBlankHandoff =
    Boolean(firstContentCompositor) &&
    frames
      .filter((frame) => frame.index >= firstContentCompositor.index)
      .every((frame) => frame.changedFraction < 0.02)
  const scrollRestored =
    JSON.stringify(before.cache?.scrollbar) === JSON.stringify(live.cache?.scrollbar)
  result = {
    completed: true,
    prefix,
    url: targetUrl.href,
    api,
    viewport,
    platform: await fingerprint('/work/projects/platform'),
    ghostty: await fingerprint('/work/projects/ghostty-webgpu'),
    recipeHash: createHash('sha256')
      .update(await readFile(new URL(import.meta.url)))
      .digest('hex'),
    release,
    marker,
    region,
    nativeCanvasRectangle: rectangle,
    before,
    held,
    live,
    heldCount,
    heldMatch,
    liveMatch,
    calibration,
    blockedInput,
    scrollRestored,
    firstPane,
    firstContentCompositor,
    navigationBlank,
    noBlankHandoff,
    frames,
    heldFrames,
    connections,
    errors,
    exceptions,
    discardedClosedMockMessages: await page.evaluate(() => window.__terminalProofDiscardedMessages),
  }
  result.passed =
    heldCount > 0 &&
    held.saved &&
    held.inert &&
    blockedInput &&
    calibration.changedFraction > 0.1 &&
    heldMatch.changedFraction < 0.02 &&
    liveMatch.changedFraction < 0.02 &&
    scrollRestored &&
    firstPane?.saved === true &&
    firstContentCompositor?.changedFraction < 0.02 &&
    noBlankHandoff &&
    errors.length === 0
  console.log(
    JSON.stringify({
      passed: result.passed,
      heldCount,
      heldMatch,
      liveMatch,
      calibration,
      blockedInput,
      scrollRestored,
      firstPane,
      errors,
      output,
    }),
  )
  if (values.check && !result.passed) process.exitCode = 1
} catch (error) {
  result = {
    ...result,
    failure: error instanceof Error ? error.message : String(error),
    errors,
    connections,
    exceptions,
  }
  await page.screenshot({ path: `${output}/failure.png` }).catch(() => {})
  console.log(JSON.stringify({ failure: result.failure, errors, output }))
  process.exitCode = 1
} finally {
  await page.close()
  const cleanup = []
  for (const owner of owners.values()) {
    const response = await context.request.post(`${api}terminal/kill`, {
      data: owner,
      headers: { Origin: new URL(values.url).origin },
    })
    cleanup.push({ ...owner, status: response.status(), result: await response.json() })
    if (!response.ok()) process.exitCode = 1
  }
  await writeFile(`${output}/result.json`, JSON.stringify({ ...result, cleanup }, null, 2))
  await browser.close()
}

function describeMessage(message) {
  if (typeof message !== 'string')
    return { kind: 'output', bytes: message.length, text: message.toString('utf8') }
  try {
    return JSON.parse(message)
  } catch {
    return { kind: 'text', text: message }
  }
}
async function until(condition, message) {
  for (let i = 0; i < 200; i++) {
    if (await condition()) return
    await page.waitForTimeout(50)
  }
  throw createBenchmarkError(message)
}
async function cacheRecord() {
  return page.evaluate(() => {
    const key = Object.keys(sessionStorage).find((key) => key.endsWith('terminal.display.v1'))
    return key ? JSON.parse(sessionStorage.getItem(key)) : null
  })
}
async function inspect() {
  return page.evaluate(() => {
    const pane = document.querySelector('[data-slot="tool-pane"][aria-label="Terminal"]')
    const key = Object.keys(sessionStorage).find((key) => key.endsWith('terminal.display.v1'))
    const record = key ? JSON.parse(sessionStorage.getItem(key)) : null
    const paint = record ? JSON.parse(record.paint) : null
    return {
      saved: Boolean(pane?.querySelector('[data-terminal-presentation="saved"] canvas')),
      inert: Boolean(pane?.querySelector('[inert]')),
      text: pane?.querySelector('[aria-label="Terminal screen"]')?.textContent,
      restoreMeasures: performance
        .getEntriesByType('measure')
        .filter((entry) => entry.name === 'workspace.reload.terminal.display.v1')
        .map((entry) => ({ name: entry.name, durationMs: entry.duration, ...entry.detail })),
      cache: paint
        ? {
            width: paint.width,
            height: paint.height,
            font: paint.font,
            scrollbar: paint.scrollbar,
            lines: paint.rows.map((row) => row.map((cell) => cell[1]).join('')),
            bytes: record.paint.length * 2,
          }
        : null,
    }
  })
}
async function compare(left, right, region) {
  return page.evaluate(
    async ({ left, right, region }) => {
      async function pixels(encoded) {
        const bytes = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
        const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
        const canvas = document.createElement('canvas')
        canvas.width = region.width
        canvas.height = region.height
        const context = canvas.getContext('2d')
        context.drawImage(bitmap, -region.x, -region.y)
        bitmap.close()
        return context.getImageData(0, 0, region.width, region.height).data
      }
      const a = await pixels(left)
      const b = await pixels(right)
      let changed = 0
      let difference = 0
      for (let i = 0; i < a.length; i += 4) {
        const delta = Math.max(
          Math.abs(a[i] - b[i]),
          Math.abs(a[i + 1] - b[i + 1]),
          Math.abs(a[i + 2] - b[i + 2]),
        )
        if (delta > 16) changed++
        difference += delta
      }
      return {
        changedFraction: changed / (a.length / 4),
        meanDifference: difference / (a.length / 4),
      }
    },
    { left: left.toString('base64'), right: right.toString('base64'), region },
  )
}
async function fingerprint(path) {
  const git = (args) => execFileSync('git', args, { cwd: path })
  const hash = createHash('sha256').update(git(['diff', 'HEAD']))
  const untracked = git(['ls-files', '--others', '--exclude-standard', '-z'])
    .toString()
    .split('\0')
    .filter(Boolean)
    .sort()
  for (const file of untracked) hash.update(file).update(await readFile(resolve(path, file)))
  return { path, sha: git(['rev-parse', 'HEAD']).toString().trim(), diffHash: hash.digest('hex') }
}
