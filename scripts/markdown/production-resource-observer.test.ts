import { existsSync } from 'node:fs'
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { startProductionCdp } from './production-cdp'
import {
  observeProductionBrowserResources,
  observeProductionWorkerLifetimes,
} from './production-resource-observer'

const unavailable = !existsSync(chromium.executablePath())
if (unavailable)
  console.info('Browser resource observer tests require an installed Playwright Chromium.')

// About 10 MiB of small objects: far above post-GC noise, small enough for any CI runner.
const RETAINED_OBJECTS = 1 << 19
const MINIMUM_RETAINED_BYTES = 4 * 1024 * 1024
const WORKER_SOURCE = `
self.onmessage = ({ data }) => {
  self.retained = data === 'retain' ? Array.from({ length: ${RETAINED_OBJECTS} }, (_, value) => ({ value })) : null
  postMessage(data)
}
`

describe.skipIf(unavailable)('production browser resource observer', () => {
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let instrumentation: Awaited<ReturnType<typeof startProductionCdp>>
  let heap: CDPSession

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true })
  })
  afterAll(async () => {
    await browser?.close()
  })
  beforeEach(async () => {
    context = await browser.newContext()
    page = await context.newPage()
    await page.setContent('<main>resource observer</main>')
    instrumentation = await startProductionCdp(page)
    heap = await context.newCDPSession(page)
  })
  afterEach(async () => {
    await heap?.detach().catch(() => undefined)
    await instrumentation?.close().catch(() => undefined)
    await context?.close()
  })

  async function pageUsed() {
    return (
      (await observeProductionBrowserResources(instrumentation, heap)).page.jsHeapUsedBytes ?? 0
    )
  }

  async function workerUsed() {
    const { heaps } = await observeProductionBrowserResources(instrumentation, heap)
    expect(heaps).toHaveLength(1)
    const [entry] = heaps
    expect(entry?.measurement).toBe('complete')
    return entry?.measurement === 'complete' ? entry.heap.usedSize : 0
  }

  test('post-GC page heap reports a retained allocation and its release', async () => {
    const baseline = await pageUsed()
    await page.evaluate((count) => {
      Reflect.set(
        globalThis,
        'retained',
        Array.from({ length: count }, (_, value) => ({ value })),
      )
    }, RETAINED_OBJECTS)
    const retained = await pageUsed()
    await page.evaluate(() => Reflect.deleteProperty(globalThis, 'retained'))
    const released = await pageUsed()

    expect(retained - baseline).toBeGreaterThan(MINIMUM_RETAINED_BYTES)
    expect(retained - released).toBeGreaterThan((retained - baseline) * 0.9)
  })

  test('worker heap and lifetime receipts follow creation, retention, release and termination', async () => {
    const lifetimes = observeProductionWorkerLifetimes(page)
    try {
      const created = page.waitForEvent('worker')
      await page.evaluate((source) => {
        const worker = new Worker(URL.createObjectURL(new Blob([source])))
        Reflect.set(globalThis, 'observedWorker', worker)
      }, WORKER_SOURCE)
      const worker = await created
      const send = (message: string) =>
        page.evaluate((value) => {
          const target: unknown = Reflect.get(globalThis, 'observedWorker')
          if (!(target instanceof Worker)) return null
          return new Promise((resolve) => {
            target.addEventListener('message', resolve, { once: true })
            target.postMessage(value)
          }).then(() => value)
        }, message)

      expect(await send('release')).toBe('release')
      const baseline = await workerUsed()
      expect(await send('retain')).toBe('retain')
      const retained = await workerUsed()
      expect(await send('release')).toBe('release')
      const released = await workerUsed()
      const closed = worker.waitForEvent('close')
      await page.evaluate(() => {
        const target: unknown = Reflect.get(globalThis, 'observedWorker')
        if (target instanceof Worker) target.terminate()
      })
      await closed
      const after = await observeProductionBrowserResources(instrumentation, heap)

      expect(retained - baseline).toBeGreaterThan(MINIMUM_RETAINED_BYTES)
      expect(retained - released).toBeGreaterThan((retained - baseline) * 0.9)
      // CDP may report the detach after Playwright's close; the closing target is then unavailable.
      expect(after.heaps.filter((entry) => entry.measurement === 'complete')).toEqual([])
      expect(after.workers.created).toBe(1)
      expect(after.workers.active).toBe(0)
      const [lifetime] = lifetimes.read()
      expect(lifetimes.read()).toHaveLength(1)
      expect(lifetime?.closedAtMs).not.toBeNull()
      expect(lifetime?.closedAtMs ?? 0).toBeGreaterThan(lifetime?.createdAtMs ?? Infinity)
    } finally {
      lifetimes.close()
    }
  })
})
