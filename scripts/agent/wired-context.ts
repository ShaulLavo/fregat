import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'

/**
 * A page in its own browser context, talking to the same throwaway server as `page`. Tabs of one
 * context share six HTTP/1.1 connections and each tab holds four streams, so a second tab stalls.
 */
export async function openWiredContextPage(page: Page) {
  const browser = page.context().browser()
  ok(browser, 'The scenario browser is unavailable')
  const serverUrl = await page.evaluate(
    () => (window as { platformDevServerUrl?: string }).platformDevServerUrl ?? null,
  )
  const context = await browser.newContext({ viewport: page.viewportSize() })
  if (serverUrl)
    await context.addInitScript(`window.platformDevServerUrl = ${JSON.stringify(serverUrl)}`)
  return { page: await context.newPage(), close: () => context.close() }
}
