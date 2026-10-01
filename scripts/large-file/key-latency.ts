import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

export const KEY_MEASURE = 'large-file-key'

type KeyLatencyWait = {
  /** How long the last keydowns may take to reach their requestAnimationFrame callback. */
  readonly timeoutMs: number
  /** The pause earlier runs took after the last key, kept so memory and GC samples stay comparable. */
  readonly settleMs: number
}

const DEFAULT_WAIT: KeyLatencyWait = { timeoutMs: 30_000, settleMs: 200 }

/**
 * Summarizes the keydown-to-requestAnimationFrame-callback samples once every key has one. A
 * software-rasterizing host takes ~650 ms per callback, so a fixed pause alone dropped samples.
 */
export async function collectKeyLatency(page: Page, keys: number, wait = DEFAULT_WAIT) {
  await page
    .waitForFunction(
      ({ name, expected }) => performance.getEntriesByName(name).length >= expected,
      { name: KEY_MEASURE, expected: keys },
      { timeout: wait.timeoutMs },
    )
    // The assertion below reports how many samples arrived.
    .catch(() => {})
  await page.waitForTimeout(wait.settleMs)
  const values = await page.evaluate(
    (name) => performance.getEntriesByName(name).map((entry) => entry.duration),
    KEY_MEASURE,
  )
  strictEqual(values.length, keys, 'Every keydown must reach a requestAnimationFrame callback')
  values.sort((a, b) => a - b)
  return {
    count: values.length,
    p50: values[Math.floor(values.length * 0.5)],
    p95: values[Math.min(values.length - 1, Math.ceil(values.length * 0.95) - 1)],
    max: values.at(-1),
  }
}
