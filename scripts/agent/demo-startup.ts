import type { Page } from 'playwright'
import { selectors } from './selectors'
import { createScriptError } from '../structured-errors'

export async function reloadDelayedDemo(page: Page, resource: string, delayMs: number) {
  await page.context().route(resource, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, delayMs))
    await route.continue()
  })
  await page.reload({ waitUntil: 'commit' })
  await selectors.demoIframe(page).waitFor({ state: 'visible' })
  const frame = await (await selectors.demoIframe(page).elementHandle())?.contentFrame()
  if (!frame) throw createScriptError('The demo iframe did not mount.')
  return frame
}
