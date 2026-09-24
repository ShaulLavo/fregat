import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'

export function readClipboard(page: Page) {
  return page.evaluate(() => navigator.clipboard.readText())
}

/** The clipboard is the proof; a toast from an earlier copy may still be on screen. */
export async function expectClipboard(page: Page, expected: string, message: string) {
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    if ((await readClipboard(page)) === expected) return
    await page.waitForTimeout(50)
  }
  strictEqual(await readClipboard(page), expected, message)
}
