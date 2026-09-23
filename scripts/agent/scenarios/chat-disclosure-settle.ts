import { ok } from 'node:assert/strict'
import type { Locator, Page } from 'playwright'
import type { Scenario } from './index'
import { selectors } from '../selectors'

const SESSION_SCAN_LIMIT = 12

export const chatDisclosureSettle: Scenario = {
  name: 'chat-disclosure-settle',
  description:
    'Opening and closing a transcript disclosure keeps it under the pointer, and the rows around it stay apart.',
  async run(page, { step }) {
    await selectors.workspaceMode(page, 'Chat').click()
    ok(await openSessionWithDisclosure(page), 'No session in the rail has a collapsed disclosure')
    const disclosure = selectors.chatDisclosures(page).first()
    await disclosure.scrollIntoViewIfNeeded()
    await step('before')

    // The row holds still; the button itself may sit below the body it opens.
    const rowId = await disclosure.evaluate((element) =>
      element.closest('[data-timeline-row-id]')?.getAttribute('data-timeline-row-id'),
    )
    ok(rowId, 'The disclosure must sit in a timeline row')
    const row = selectors.timelineRow(page, rowId)
    const before = await topOf(row)
    await disclosure.click()
    await page.waitForTimeout(400)
    await step('expanded')
    const after = await topOf(row)
    ok(Math.abs(after - before) <= 1, `Row ${rowId} moved from ${before} to ${after} as it opened`)
    await assertSeparatedRows(page)

    await selectors.openDisclosure(row).click()
    await page.waitForTimeout(400)
    await step('collapsed')
    await assertSeparatedRows(page)
  },
}

async function openSessionWithDisclosure(page: Page) {
  const sessions = selectors.sessionRows(page)
  await sessions.first().waitFor()
  const count = Math.min(await sessions.count(), SESSION_SCAN_LIMIT)
  for (let index = 0; index < count; index += 1) {
    await sessions.nth(index).click()
    await selectors.timelineRows(page).first().waitFor()
    await page.waitForTimeout(300)
    if ((await selectors.chatDisclosures(page).count()) > 0) return true
  }
  return false
}

async function topOf(locator: Locator) {
  const box = await locator.boundingBox()
  ok(box, 'The row must be laid out')
  return box.y
}

async function assertSeparatedRows(page: Page) {
  const rows = await selectors.timelineRows(page).evaluateAll((elements) =>
    elements.map((row) => ({
      id: row.getAttribute('data-timeline-row-id'),
      ...row.getBoundingClientRect().toJSON(),
    })),
  )
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1]!
    const current = rows[index]!
    ok(current.top >= previous.bottom - 1, `Timeline rows ${previous.id} and ${current.id} overlap`)
  }
}
