import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { once } from 'node:events'
import { createHash, randomUUID } from 'node:crypto'
import { createFixture } from './fixture.mjs'
import { fitWindow, fitGrid, displayProbe, assertDisplay } from './display-helpers.mjs'
import { nativeSnapshot, nativeDelta, assertWork } from './measure.mjs'
import { loadActorDocument, canvasContextAttributes } from './actor-document.mjs'
import { settleFontGeometry } from './font-settlement.mjs'
import { settleScreenshot } from './raster-settlement.mjs'
import {
  assertReaderCapabilities,
  assertCalibrationBeforeWindow,
} from './reader-capability-guard.mjs'

const root = import.meta.dirname
const prepared = process.argv[2]
const protocolBytes = await readFile(process.argv[3])
const protocol = JSON.parse(protocolBytes)
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
assert.equal(process.platform, 'darwin')
assert.match(protocol.id, /^m2-segments-[a-z0-9-]+$/)
assert(protocol.blocks >= 1 && protocol.blocks <= 32)
const out = join(root, protocol.id)
await mkdir(out)
const sealBytes = await readFile(join(root, 'seal.json'))
const seal = JSON.parse(sealBytes)
for (const [file, digest] of Object.entries(seal.files))
  assert.equal(sha(await readFile(join(root, file))), digest, file)
const recipeBytes = await readFile(join(prepared, 'a/b/outer/cpu-outer-recipe.json'))
const recipe = JSON.parse(recipeBytes)
const { chromium } = createRequire(join(prepared, 'a/b/stage/package.json'))('playwright')
const result = {
  id: protocol.id,
  protocol,
  protocolSha256: sha(protocolBytes),
  sessionId: randomUUID(),
  startedAt: new Date().toISOString(),
  sealSha256: sha(sealBytes),
  driverSha256: sha(await readFile(join(root, 'segments.mjs'))),
  readerSha256: sha(await readFile(join(root, 'rusage.py'))),
  recipeSha256: sha(recipeBytes),
  recipe,
  endpoint:
    'Native boundaries enclose unchanged R07 reset, paced writes, two RAFs and target snapshots. Optional injected instructions follow settlement. Idle and switch controls are separate. Shared processes belong to the active segment.',
  runs: [],
  idle: [],
  arms: {},
}
const save = () => writeFile(join(out, 'index.json'), JSON.stringify(result, null, 2) + '\n')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
function hostState() {
  for (const marker of ['RECLAIMED', 'EXPERIMENT_HOLD'])
    assert(!existsSync(join(process.env.HOME, 'tmp/ghostty-bench', marker)), marker)
  const battery = execFileSync('/usr/bin/pmset', ['-g', 'batt'], {
    encoding: 'utf8',
    timeout: 2000,
  })
  const loads = execFileSync('/usr/sbin/sysctl', ['-n', 'vm.loadavg'], {
    encoding: 'utf8',
    timeout: 2000,
  })
  const state = {
    at: new Date().toISOString(),
    ac: battery.includes("'AC Power'"),
    load: Number(loads.replace(/[{}]/g, '').trim().split(/\s+/)[0]),
  }
  assert(state.ac, 'AC power required')
  return state
}
let browser, reader, replies
const contexts = []
const fixture = createFixture(join(root, 'packet'))
const soft = setTimeout(() => {
  result.stopReason = '550-second driver limit'
  void browser?.close()
}, 550000)
const hard = setTimeout(() => process.exit(1), 570000)
async function startReader() {
  assert(!reader)
  reader = spawn('/usr/bin/python3', [join(root, 'rusage.py')], {
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  replies = createInterface({ input: reader.stdout })[Symbol.asyncIterator]()
  const reply = await replies.next()
  assert(!reply.done)
  const ready = JSON.parse(reply.value)
  assertReaderCapabilities(ready)
  return ready
}
async function stopReader() {
  const child = reader
  reader = undefined
  replies = undefined
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const exit = once(child, 'exit')
  child.stdin.end()
  await exit
}
async function rusage(pids) {
  reader.stdin.write(JSON.stringify({ pids }) + '\n')
  const reply = await replies.next()
  assert(!reply.done)
  return JSON.parse(reply.value)
}
async function spin(page, iterations) {
  return page.evaluate((n) => {
    let value = window.__injectionValue ?? 1
    for (let i = 0; i < n; i++) value = (Math.imul(value ^ i, 1664525) + 1013904223) | 0
    window.__injectionValue = value
    return value
  }, iterations)
}
const semanticHash = (content) =>
  sha(
    JSON.stringify(
      content.map((target) => ({
        text: target.rendererGraphemeText,
        historyRows: target.historyRows,
        retainedRows: target.retainedRows,
        retainedTextSha256: target.retainedTextSha256,
      })),
    ),
  )
function pidDelta(native, pid) {
  return native.perPid.find((row) => row.pid === pid)
}

try {
  result.initialHost = hostState()
  assert(result.initialHost.load < 4, 'Load admission required')
  const port = await fixture.start()
  browser = await chromium.launch({
    executablePath: recipe.browserExecutable,
    headless: false,
    args: recipe.browserLaunchArguments,
    timeout: 20000,
  })
  result.browserVersion = browser.version()
  assert.equal(result.browserVersion, recipe.browserVersion)
  const cdp = await browser.newBrowserCDPSession()
  result.backend = await cdp.send('SystemInfo.getInfo')
  assert(!JSON.stringify(result.backend.gpu).includes('SwiftShader'))
  await sleep(20000)
  const arms = {}
  for (const label of ['A', 'B']) {
    const definition = protocol.arms[label]
    const context = await browser.newContext({ viewport: null })
    contexts.push(context)
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const session = await context.newCDPSession(page)
    const loaded = await loadActorDocument(
      page,
      `http://127.0.0.1:${port}`,
      definition,
      new URLSearchParams({ accessibility: 'off' }),
      seal.files[`packet/${definition.bundle}`],
    )
    const windowGeometry = await fitWindow(page, cdp, session)
    await page.evaluate(
      (count) => window.__compare.prepare({ variant: 'ghostty-canvas', count, path: 'bytes' }),
      protocol.count,
    )
    await page.evaluate((font) => window.__direct.setFont(font), protocol.font)
    await settleFontGeometry(page, protocol.geometry, protocol.count)
    const grid = await fitGrid(page)
    const geometry = await page.evaluate(() => window.__direct.snapshot())
    for (const target of geometry) {
      assert.equal(target.dpr, 2)
      assert.equal(target.contextLost, false)
      const canvas = target.geometry.filter((canvas) => canvas.renderingCanvas)
      assert.equal(canvas.length, 1)
      assert.equal(canvas[0].width, protocol.geometry.width)
      assert.equal(canvas[0].height, protocol.geometry.height)
      assert(canvas[0].visible)
    }
    const canvasContexts = await canvasContextAttributes(page, protocol.count)
    const display = await displayProbe({ page, session, browserSession: cdp, metadata: { label } })
    assertDisplay(display)
    const warmup = await page.evaluate(
      ({ workload, ticks }) => window.__direct.measured(workload, ticks),
      { workload: protocol.workload, ticks: protocol.warmupTicks },
    )
    assertWork(warmup, protocol.count, protocol.warmupTicks)
    for (let i = 0; i < 8; i++) await spin(page, 1000000)
    const info = {
      definition,
      loaded,
      windowGeometry,
      grid,
      geometry,
      canvasContexts,
      display,
      warmup,
      errors,
    }
    result.arms[label] = info
    arms[label] = { page, session, info, lastTarget: warmup.after }
  }
  await sleep(protocol.setupSettleMs ?? 2000)
  result.identificationReader = await startReader()
  for (const label of ['A', 'B']) {
    const arm = arms[label]
    await arm.page.bringToFront()
    await sleep(300)
    const before = await nativeSnapshot(cdp, rusage)
    await spin(arm.page, 10000000)
    const after = await nativeSnapshot(cdp, rusage, 'after')
    const native = nativeDelta(before, after)
    const ranked = native.perPid
      .filter((row) => row.type === 'renderer')
      .sort((a, b) => b.ri_instructions - a.ri_instructions)
    assert(ranked[0].ri_instructions > 1000000)
    assert(
      ranked[0].ri_instructions > 20 * (ranked[1]?.ri_instructions ?? 0),
      'Renderer ownership ambiguous',
    )
    arm.pid = ranked[0].pid
    arm.info.pid = arm.pid
    arm.info.identification = { before, after, native }
  }
  assert.notEqual(arms.A.pid, arms.B.pid, 'Arms share a renderer process')
  await stopReader()
  if (protocol.injectionIterations) {
    result.injectionCalibration = []
    await arms.B.page.bringToFront()
    result.injectionReader = await startReader()
    for (const iterations of [0, 1000000, 1000000, 0]) {
      const before = await nativeSnapshot(cdp, rusage)
      await spin(arms.B.page, iterations)
      const after = await nativeSnapshot(cdp, rusage, 'after')
      result.injectionCalibration.push({
        iterations,
        before,
        after,
        native: nativeDelta(before, after),
      })
    }
    await stopReader()
  }
  const idleControl = async (kind, label, milliseconds) => {
    const before = await nativeSnapshot(cdp, rusage)
    await sleep(milliseconds)
    const after = await nativeSnapshot(cdp, rusage, 'after')
    result.idle.push({
      kind,
      label,
      milliseconds,
      before,
      after,
      native: nativeDelta(before, after),
    })
  }
  result.idleReader = await startReader()
  await idleControl('pre-run-idle', 'B', 3000)
  await stopReader()
  for (let block = 0; block < protocol.blocks; block++) {
    const order = block % 2 ? ['B', 'A', 'A', 'B'] : ['A', 'B', 'B', 'A']
    for (const [position, label] of order.entries()) {
      const arm = arms[label]
      const idleLabel = label === 'A' ? 'B' : 'A'
      const inactive = arms[idleLabel]
      const row = {
        index: result.runs.length,
        block,
        position,
        order: order.join(''),
        label,
        activePid: arm.pid,
        idlePid: inactive.pid,
        hostBefore: hostState(),
      }
      result.runs.push(row)
      await arm.page.bringToFront()
      await sleep(protocol.switchSettleMs)
      row.visibility = await arm.page.evaluate(() => ({
        visibility: document.visibilityState,
        focus: document.hasFocus(),
      }))
      assert.equal(row.visibility.visibility, 'visible')
      row.readerReady = await startReader()
      const before = await nativeSnapshot(cdp, rusage)
      assertCalibrationBeforeWindow(row.readerReady, before)
      row.measured = await arm.page.evaluate(
        ({ workload, ticks }) => window.__direct.measured(workload, ticks),
        { workload: protocol.workload, ticks: protocol.ticks },
      )
      if (protocol.injectionIterations)
        row.injectionValue = await spin(arm.page, label === 'B' ? protocol.injectionIterations : 0)
      const after = await nativeSnapshot(cdp, rusage, 'after')
      row.snapshots = { before, after }
      row.native = nativeDelta(before, after)
      row.targetWork = assertWork(row.measured, protocol.count, protocol.ticks)
      row.idleRenderer = pidDelta(row.native, inactive.pid)
      row.activeRenderer = pidDelta(row.native, arm.pid)
      row.wallSeconds =
        Number(BigInt(after.nativeCompletedNs) - BigInt(before.nativeRequestedNs)) / 1e9
      if (protocol.tailProbeMs) await idleControl('post-segment-tail', label, protocol.tailProbeMs)
      await stopReader()
      assert.deepEqual(
        row.measured.before.map((row) => row.counters),
        arm.lastTarget.map((row) => row.counters),
        'Terminal received work while inactive',
      )
      arm.lastTarget = row.measured.after
      row.idleWorkUnchanged = true
      if (protocol.workload === 'interactive-edits')
        for (const target of row.measured.after) assert.equal(target.historyRows, 0)
      row.hostAfter = hostState()
      row.complete = true
      await save()
    }
  }
  result.finalReader = await startReader()
  await idleControl('post-run-idle', result.runs.at(-1).label, 3000)
  await stopReader()
  for (const label of ['A', 'B']) {
    await arms[label].page.bringToFront()
    const finalTarget = await arms[label].page.evaluate(() => window.__direct.snapshot(false))
    assert.deepEqual(
      finalTarget.map((row) => row.counters),
      arms[label].lastTarget.map((row) => row.counters),
      'Final inactive terminal received work',
    )
    const content = await arms[label].page.evaluate(() => window.__direct.content())
    result.arms[label].finalContent = content
    result.arms[label].contentSha256 = semanticHash(content)
    result.arms[label].rgbaHashes = await arms[label].page.evaluate(async () => {
      const hashes = []
      for (const canvas of document.querySelectorAll('canvas.ghostty-webgpu-canvas')) {
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
        const digest = await crypto.subtle.digest('SHA-256', pixels)
        hashes.push(
          Array.from(new Uint8Array(digest), (x) => x.toString(16).padStart(2, '0')).join(''),
        )
      }
      return hashes
    })
    result.arms[label].screenshotSettlement = await settleScreenshot(arms[label].page)
    result.arms[label].screenshotSha256 = sha(
      await arms[label].page.screenshot({ path: join(out, `${label}.png`) }),
    )
    result.arms[label].finalGeometry = await arms[label].page.evaluate(() =>
      window.__direct.snapshot(),
    )
    assert.deepEqual(arms[label].info.errors, [])
  }
  assert.equal(
    result.arms.A.contentSha256,
    result.arms.B.contentSha256,
    'Final logical output differs',
  )
  assert.deepEqual(
    result.arms.A.rgbaHashes,
    result.arms.B.rgbaHashes,
    'Final raster output differs',
  )
  result.complete = true
} catch (error) {
  result.failure = String(error.stack ?? error)
  process.exitCode = 1
} finally {
  clearTimeout(soft)
  await stopReader()
  for (const context of contexts) await context.close().catch(() => {})
  await browser?.close()
  result.browserClosed = true
  await fixture.close()
  clearTimeout(hard)
  result.fixtureRequests = fixture.requests
  result.finishedAt = new Date().toISOString()
  await save()
}
console.log(
  JSON.stringify({
    id: result.id,
    complete: result.complete,
    failure: result.failure,
    segments: result.runs.filter((row) => row.complete).length,
  }),
)
