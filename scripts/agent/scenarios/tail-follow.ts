import { ok, strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import { selectors } from '../selectors'
import { serverApi } from '../server-api'
import type { Scenario } from './index'

/** Each tree read is one logged request, so this is a way to make log lines arrive. */
async function logRequests(page: Page, count: number) {
  const { base, headers } = serverApi(page)
  for (let index = 0; index < count; index += 1) {
    await page.request.get(`${base}/fs/tree?depth=1&path=work%2Fprojects%2Fplatform`, { headers })
  }
}

/** The id of the row under the list's top edge: what the reader is looking at. */
function topRowId(page: Page) {
  return selectors.logList(page).evaluate((list) => {
    const bounds = list.getBoundingClientRect()
    const row = document
      .elementFromPoint(bounds.left + 40, bounds.top + 8)
      ?.closest('[data-log-event-id]')
    return row?.getAttribute('data-log-event-id') ?? null
  })
}

export const tailFollow: Scenario = {
  name: 'tail-follow',
  description:
    'Scroll a live log list away from its newest line, let lines arrive, read the "N new lines" count, check the reader stayed put, and jump back.',
  async run(page, { step }) {
    await selectors.logsTab(page).click()
    await logRequests(page, 60)
    const list = selectors.logList(page)
    await page.waitForFunction(
      () => document.querySelectorAll('[data-log-row-summary]').length > 30,
      undefined,
      { timeout: 20_000 },
    )
    await list.evaluate((element) => {
      element.scrollTop = 400
    })
    await page.waitForTimeout(300)
    const away = await list.evaluate((element) => ({
      top: element.scrollTop,
      pinned: element.hasAttribute('data-pinned'),
    }))
    ok(
      away.top > 100 && !away.pinned,
      `Scrolled away from the newest line: ${JSON.stringify(away)}`,
    )
    await selectors.tailJump(page).filter({ hasText: 'Follow output' }).waitFor()
    const before = await topRowId(page)
    await logRequests(page, 5)
    const jump = selectors.tailJump(page)
    await jump.filter({ hasText: /new lines?/ }).waitFor({ timeout: 20_000 })
    await page.waitForTimeout(500)
    const after = await topRowId(page)
    const top = await list.evaluate((element) => element.scrollTop)
    strictEqual(
      after,
      before,
      `Arrivals must not move the line being read (scrollTop ${away.top} → ${top})`,
    )
    await step('arrivals-counted')

    await jump.click()
    await page.waitForFunction(() => {
      const element = document.querySelector('[aria-label="Log events"]')
      return element !== null && element.scrollTop <= 1
    })
    await jump.waitFor({ state: 'detached' })
    ok(
      await list.evaluate((element) => element.hasAttribute('data-pinned')),
      'Back at the edge, the list follows',
    )
    await step('following-again')
  },
}
