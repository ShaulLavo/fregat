import { deepStrictEqual, strictEqual } from 'node:assert/strict'
import type { Page, Route } from 'playwright'
import { countBlankFrames } from '../blank-frames'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

const HEALTH = '**/health'

/** Holds the health check long enough to see the pending frame, then fails it. */
async function failSlowly(route: Route) {
  await new Promise((resolve) => setTimeout(resolve, 1_200))
  await route.abort('connectionrefused')
}

async function frameBox(page: Page) {
  const box = await selectors.statusFrameBody(page).boundingBox()
  if (!box) throw new TypeError('Expected the status frame on screen')
  return box
}

export const connectionFrame: Scenario = {
  name: 'connection-frame',
  description:
    'Boot against an unreachable server: the pending and error frames share one box, no frame is blank between them, and Retry connects.',
  async run(page, { step }) {
    await page.route(HEALTH, failSlowly)
    try {
      // A cached binding boots the app offline instead; this drive is the first visit.
      await page.evaluate('localStorage.clear()')
      await page.reload({ waitUntil: 'domcontentloaded' })
      await selectors.statusFrame(page, 'pending').waitFor()
      const pending = await frameBox(page)
      await step('pending')
      const blank = await countBlankFrames(page, '[data-slot="status-frame"]', () =>
        selectors.statusFrame(page, 'error').waitFor(),
      )
      strictEqual(blank, 0, 'The frame must stay on screen from pending to error')
      deepStrictEqual(await frameBox(page), pending, 'The error frame must keep the pending box')
      await step('error')
    } finally {
      await page.unroute(HEALTH)
    }
    await selectors
      .statusFrame(page, 'error')
      .getByRole('button', { name: 'Retry connection' })
      .click()
    await waitForApp(page)
    await step('connected')
  },
}
