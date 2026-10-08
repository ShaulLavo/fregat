import { createRequire } from 'node:module'
// Use the editor site's pinned Playwright dependency from the root workspace install.
const { chromium } = createRequire(new URL('../../site/package.json', import.meta.url))(
  'playwright',
)
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const directory = resolve(process.argv[2])
const port = Number(process.argv[3])
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new TypeError('Pass a built directory and an unused port')
const server = spawn('bun', [resolve(directory, 'server.mjs'), '--port', String(port)], {
  stdio: ['ignore', 'pipe', 'inherit'],
})
let browser
try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(() => {
      throw new TypeError('Probe server exited before readiness')
    }),
  ])
  browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const origin = `http://127.0.0.1:${port}`
  await page.goto(origin)
  await page.waitForFunction(
    () => window.scrollProbe && document.querySelectorAll('[data-editor-virtual-row]').length > 10,
  )
  const baselineCount = await page.locator('[data-editor-virtual-row]').count()
  assert(
    await page.evaluate(() => {
      const probe = window.scrollProbe
      const descriptor = Object.getOwnPropertyDescriptor(probe.scroller, 'scrollTop')
      Object.defineProperty(probe.scroller, 'scrollTop', { configurable: true, get: () => 123456 })
      const native = probe.readNativeScrollTop()
      Object.defineProperty(probe.scroller, 'scrollTop', descriptor)
      return native === 0
    }),
    'Native observation must bypass Singapore logical scrollTop',
  )
  await page.evaluate(async () => {
    const probe = window.scrollProbe
    probe.start()
    probe.scroller.scrollTop = 2000
    for (let i = 0; i < 20; i++) await new Promise(requestAnimationFrame)
    const content = document.querySelector(
      '.editor-virtualized-text-clip .editor-virtualized-content',
    )
    content.style.setProperty('transform', 'translateY(-1900px)', 'important')
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
    content.style.removeProperty('transform')
    probe.scroller.scrollTop = 2020
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
    await probe.stop()
  })
  const measured = await page.evaluate(() => window.scrollProbe.getRuns().at(-1))
  assert(
    measured.frames.some((frame) => Math.abs(frame.lagPx ?? 0) >= 99),
    'Known 100 px paint shift must register',
  )
  assert(
    measured.frames.some((frame) => frame.lagPx === 0),
    'Known-good rows must register zero lag',
  )
  assert(measured.events.length > 0)
  const collected = await (await page.request.get(`${origin}/api/results`)).json()
  assert(
    collected.some((run) => run.id === measured.id && run.frames.length === measured.frames.length),
  )
  await page.goto(`${origin}/?overscan=48&position=top&paint=native&gutter=absolute&anchor=none`)
  await page.waitForFunction(
    () => document.querySelectorAll('[data-editor-virtual-row]').length > 40,
  )
  const largerCount = await page.locator('[data-editor-virtual-row]').count()
  assert(largerCount > baselineCount)
  await page.evaluate(async () => {
    const probe = window.scrollProbe
    probe.scroller.scrollTop = 2000
    for (let i = 0; i < 10; i++) await new Promise(requestAnimationFrame)
    probe.start()
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
    await probe.stop()
  })
  const native = await page.evaluate(() => window.scrollProbe.getRuns().at(-1))
  assert(
    native.frames.every((frame) => Math.abs(frame.lagPx ?? 1) < 1),
    'Native document coordinates must align at rest',
  )
  assert(
    native.frames.every((frame) => Math.abs(frame.gutterErrorPx ?? 1) < 1),
    'Gutter and text must align',
  )
  assert(native.frames.every((frame) => frame.blankPx === 0))
  const css = await page.evaluate(() => ({
    anchor: getComputedStyle(window.scrollProbe.scroller).overflowAnchor,
    viewport: getComputedStyle(document.querySelector('.editor-virtualized-viewport')).position,
  }))
  assert.deepEqual(css, { anchor: 'none', viewport: 'absolute' })
  await page.goto(`${origin}/?overscan=120&geometry=off`)
  await page.waitForFunction(
    () => document.querySelectorAll('[data-editor-virtual-row]').length > 100,
  )
  const widestCount = await page.locator('[data-editor-virtual-row]').count()
  assert(widestCount > largerCount)
  await page.evaluate(async () => {
    const probe = window.scrollProbe
    probe.start()
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame)
    await probe.stop()
  })
  const timingOnly = await page.evaluate(() => window.scrollProbe.getRuns().at(-1))
  assert(timingOnly.frames.every((frame) => frame.lagPx === null && frame.blankPx === null))
  assert.equal(timingOnly.summary.blankFrames, null)
  assert.equal(timingOnly.summary.blankMaxPx, null)
  const bad = await page.request.post(`${origin}/api/results`, { data: { id: '../../bad' } })
  assert.equal(bad.status(), 400)
  assert.deepEqual(errors, [])
  await page.goto(origin)
  await page.waitForFunction(() => window.scrollProbe)
  await page.screenshot({ path: resolve(directory, 'phone-verification.png'), fullPage: true })
  const report = {
    pass: true,
    baselineCount,
    largerCount,
    widestCount,
    geometryOffCoverageIsNull: true,
    injectedLagMaxPx: Math.max(...measured.frames.map((frame) => Math.abs(frame.lagPx ?? 0))),
    baselineAndNativeCollectorSaved: true,
    pageErrors: errors,
  }
  await writeFile(resolve(directory, 'verification.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await once(server, 'exit')
}
