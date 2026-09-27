import { ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'

/** Chromium supplies device touch input; WebKit's driver exposes DOM touch events only. */
export async function longPress(page: Page, locator: Locator, holdMs: number) {
  const box = await locator.boundingBox()
  ok(box, 'The pressed element must be laid out')
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  if (page.context().browser()?.browserType().name() === 'chromium') {
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] })
    await page.waitForTimeout(holdMs)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await cdp.detach()
    return
  }
  await locator.evaluate((element, { x, y }) => {
    const touch = { identifier: 1, target: element, clientX: x, clientY: y }
    const event = new Event('touchstart', { bubbles: true, cancelable: true })
    Object.assign(event, { touches: [touch], changedTouches: [touch] })
    element.dispatchEvent(event)
  }, point)
  await page.waitForTimeout(holdMs)
  await locator.dispatchEvent('touchend', { touches: [], changedTouches: [] })
}
