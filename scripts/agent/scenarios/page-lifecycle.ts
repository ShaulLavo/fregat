import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import type { Scenario } from './index'

function startedStreams(page: Page) {
  return Promise.all(
    ['/settings/events', '/machines/events', '/fs/events'].map((suffix) =>
      page.waitForRequest((request) => new URL(request.url()).pathname.endsWith(suffix), {
        timeout: 15000,
      }),
    ),
  )
}

export const pageLifecycle: Scenario = {
  name: 'page-lifecycle',
  description:
    'Suspend and restore the retained page, then reload and verify all three subscriptions reconnect.',
  async run(page, { step }) {
    await step('connected')
    await page.evaluate(
      'window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }))',
    )
    const restored = startedStreams(page)
    await page.evaluate(
      'window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }))',
    )
    await restored
    await step('retained-page-restored')
    await selectors.windowToolbar(page).click({ position: { x: 5, y: 5 } })
    const identity = await page.evaluate('performance.timeOrigin')
    await page.evaluate(
      'window.addEventListener("beforeunload", event => event.preventDefault(), { capture: true, once: true })',
    )
    const dismissed = page.waitForEvent('dialog').then((dialog) => dialog.dismiss())
    await page.evaluate('window.location.reload()')
    await dismissed
    strictEqual(await page.evaluate('performance.timeOrigin'), identity)
    await step('cancelled-reload-stays-connected')
    await page.evaluate(
      'window.addEventListener("beforeunload", event => event.preventDefault(), { capture: true, once: true })',
    )
    const confirmed = startedStreams(page)
    const accepted = page.waitForEvent('dialog').then((dialog) => dialog.accept())
    await page.evaluate('window.location.reload()')
    await accepted
    await confirmed
    await selectors.windowToolbar(page).waitFor()
    await step('confirmed-reload-reconnects')

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const connected = startedStreams(page)
      await page.reload()
      await connected
      await selectors.windowToolbar(page).waitFor()
      ok(await selectors.windowToolbar(page).isVisible())
      await step(`reload-${attempt}`)
    }
  },
}
