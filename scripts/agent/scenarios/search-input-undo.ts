import type { Scenario } from './index'
import { selectors } from '../selectors'

async function typeThenUndo(
  page: Parameters<Scenario['run']>[0],
  box: ReturnType<typeof selectors.workspaceSearch>,
) {
  await box.click()
  await page.keyboard.type('abc', { delay: 60 })
  await page.waitForTimeout(300)
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(200)
  return box.inputValue()
}

/** Native Ctrl+Z in the search box (async navigation-owned value) versus the replace box (sync store). */
export const searchInputUndo: Scenario = {
  name: 'search-input-undo',
  description:
    'Type into the search and replace fields and press Ctrl+Z in each; report what remains.',
  async run(page, { step }) {
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.workspaceSearch(page).waitFor({ timeout: 10_000 })
    const query = await typeThenUndo(page, selectors.workspaceSearch(page))
    await step(`query-after-undo-${JSON.stringify(query)}`)
    // The toggle can sit clipped past the pane edge; the click still lands.
    await selectors.replaceToggle(page).click({ force: true })
    const replace = await typeThenUndo(page, selectors.replaceBox(page))
    await step(`replace-after-undo-${JSON.stringify(replace)}`)
  },
}
