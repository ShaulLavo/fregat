import type { Scenario } from './index'
import { countBlankFrames } from '../blank-frames'
import { selectors } from '../selectors'

/** Typing in the log search must keep the last events up until the new ones arrive. */
export const logsSearchNoFlicker: Scenario = {
  name: 'logs-search-no-flicker',
  description: 'Type a log search one key at a time and count the frames that showed no events.',
  async run(page, { step }) {
    await selectors.logsTab(page).click()
    await selectors.logRows(page).first().waitFor({ timeout: 20_000 })
    await selectors.logsSearch(page).fill('')
    await selectors.logsSearch(page).click()
    const blank = await countBlankFrames(page, selectors.logRowSelector, async () => {
      await page.keyboard.type('request', { delay: 120 })
      await page.waitForTimeout(1_500)
    })
    await step(`blank-frames-${blank}`)
    await selectors.logsSearch(page).fill('')
  },
}
