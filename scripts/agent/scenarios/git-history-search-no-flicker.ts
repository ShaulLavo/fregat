import type { Scenario } from './index'
import { countBlankFrames } from '../blank-frames'
import { openGitPanel, selectors } from '../selectors'

/** Typing in the commit search must keep the last rows up until the new ones arrive. */
export const gitHistorySearchNoFlicker: Scenario = {
  name: 'git-history-search-no-flicker',
  description: 'Type a commit search one key at a time and count the frames that showed no rows.',
  async run(page, { step }) {
    await openGitPanel(page)
    await selectors.graphButton(page).click()
    await selectors.historyRows(page).first().waitFor({ timeout: 20_000 })
    await selectors
      .historyClearSearch(page)
      .click({ timeout: 1_000 })
      .catch(() => {})
    await selectors.historySearch(page).click()
    const blank = await countBlankFrames(page, selectors.historyRowSelector, async () => {
      await page.keyboard.type('quick open', { delay: 120 })
      await page.waitForTimeout(1_500)
    })
    await step(`blank-frames-${blank}`)
    await selectors.historyClearSearch(page).click()
  },
}
