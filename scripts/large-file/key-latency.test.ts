import { existsSync } from 'node:fs'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { collectKeyLatency, KEY_MEASURE } from './key-latency'

if (!process.env.PLAYWRIGHT_BROWSERS_PATH && existsSync('/work/cache/ms-playwright'))
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/work/cache/ms-playwright'

let browser: Browser

beforeAll(async () => {
  browser = await chromium.launch({ headless: true })
})

afterAll(async () => {
  await browser?.close()
})

// Records one sample per delay, each landing that many ms after the call, like slow callbacks.
async function samples(delays: readonly number[]) {
  const page = await browser.newPage()
  await page.evaluate(
    ({ name, delays }) => {
      for (const delay of delays)
        setTimeout(() => performance.measure(name, { start: 0, end: 1 }), delay)
    },
    { name: KEY_MEASURE, delays },
  )
  return page
}

async function timed(run: () => Promise<unknown>) {
  const started = performance.now()
  const outcome = await run().then(
    (value) => ({ value, error: null }),
    (error: unknown) => ({ value: null, error }),
  )
  return { ...outcome, ms: performance.now() - started }
}

// NOT-PORTABLE: Missing Chromium silently skips these tests, including script-only CI.
describe.skipIf(!existsSync(chromium.executablePath()))('collecting key latency', () => {
  test('waits for samples that land after the settle pause', async () => {
    const page: Page = await samples([0, 0, 600])
    const { value, error } = await timed(() =>
      collectKeyLatency(page, 3, { timeoutMs: 5_000, settleMs: 200 }),
    )
    expect(error).toBeNull()
    expect(value).toMatchObject({ count: 3 })
  })

  test('still settles when every sample is already in', async () => {
    const page = await samples([0, 0])
    await page.waitForTimeout(50)
    const { ms } = await timed(() =>
      collectKeyLatency(page, 2, { timeoutMs: 5_000, settleMs: 200 }),
    )
    expect(ms).toBeGreaterThanOrEqual(200)
  })

  test('reports the shortfall once the wait times out', async () => {
    const page = await samples([0])
    const { error, ms } = await timed(() =>
      collectKeyLatency(page, 2, { timeoutMs: 400, settleMs: 0 }),
    )
    expect(String(error)).toContain('Every keydown must reach a requestAnimationFrame callback')
    expect(String(error)).toMatch(/1 !== 2/)
    expect(ms).toBeGreaterThanOrEqual(400)
  })
})
