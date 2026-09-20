import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { runPaletteCommand, selectors } from '../selectors'

async function openScrollableTranscript(page: Page) {
  const sessions = selectors.sessionRows(page)
  await sessions.first().waitFor()
  const count = await sessions.count()
  for (let index = 0; index < count; index += 1) {
    await sessions.nth(index).click()
    const messages = selectors.chatMessages(page)
    await messages.waitFor()
    await selectors.timelineRows(page).first().waitFor()
    const scrollable = await messages.evaluate(
      (element) => element.scrollHeight > element.clientHeight + 100,
    )
    if (scrollable) return
  }
  ok(false, 'The existing sessions need a transcript long enough to verify scrolling')
}

async function assertSeparatedRows(page: Page) {
  const positions = await selectors.timelineRows(page).evaluateAll((rows) =>
    rows.map((row) => {
      const bounds = row.getBoundingClientRect()
      return {
        id: row.getAttribute('data-timeline-row-id'),
        top: bounds.top,
        bottom: bounds.bottom,
      }
    }),
  )
  ok(positions.length > 0, 'The transcript must contain rendered rows')
  for (let index = 1; index < positions.length; index += 1) {
    const previous = positions[index - 1]!
    const current = positions[index]!
    ok(current.top >= previous.bottom - 1, `Timeline rows ${previous.id} and ${current.id} overlap`)
  }
}

export const chatTimelinePattern: Scenario = {
  name: 'chat-timeline',
  description:
    'Read an existing conversation, scroll its measured rows, and return to the latest message.',
  async run(page, { step }) {
    await runPaletteCommand(page, 'Chat mode')
    await openScrollableTranscript(page)
    const messages = selectors.chatMessages(page)
    await step('existing-transcript')
    await messages.focus()
    await page.keyboard.press('Control+Home')
    await page.waitForFunction(
      (element) => element !== null && element.scrollTop <= 1,
      await messages.elementHandle(),
    )
    await step('oldest-loaded-rows')
    await assertSeparatedRows(page)
    const top = await messages.evaluate((element) => element.scrollTop)
    await page.keyboard.press('PageDown')
    await step('next-transcript-page')
    ok(
      (await messages.evaluate((element) => element.scrollTop)) > top,
      'PageDown must move through the transcript',
    )
    await assertSeparatedRows(page)
    await selectors.timelineJumpToLatest(page).click()
    await page.waitForFunction(
      (element) =>
        element !== null && element.scrollHeight - element.clientHeight - element.scrollTop < 2,
      await messages.elementHandle(),
    )
    await step('latest-message')
    await assertSeparatedRows(page)
    const remaining = await messages.evaluate(
      (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
    )
    ok(remaining < 2, 'Jump to latest must settle at the content end')
  },
  async inspect(page) {
    return {
      viewport: await selectors.chatMessages(page).evaluate((element) => ({
        scrollTop: element.scrollTop,
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
      })),
      rows: await selectors.timelineRows(page).evaluateAll((rows) =>
        rows.map((row) => ({
          id: row.getAttribute('data-timeline-row-id'),
          top: row.getBoundingClientRect().top,
          bottom: row.getBoundingClientRect().bottom,
        })),
      ),
    }
  },
}
