import { ok } from 'node:assert'

import { openFileByName, searchEditorFileRowSelector, selectors } from '../selectors'
import type { Scenario } from './index'
import { paintVisualSearch, settledVisualSearch } from './visual-search-drive'

const QUERY = 'fixture'
const FILE = '**/proxy-session.test.ts'
const ROW_STRIDE = 28
const inspections = new WeakMap<object, unknown>()

/** A file with hundreds of matches shows every one of them in the search view. */
export const searchViewAllMatches: Scenario = {
  name: 'search-view-all-matches',
  readOnly: true,
  description: `Search "${QUERY}" in ${FILE} (over 200 matches in one file), open the search editor, scroll to the end of the file block and read its last source line.`,
  async run(page, { step }) {
    await openFileByName(page, 'README.md')
    await selectors.sidebarTab(page, 'Search').click()
    await selectors.searchFilterToggle(page).click()
    await selectors.searchInclude(page).fill(FILE)
    await selectors.workspaceSearch(page).fill(QUERY)
    await settledVisualSearch(page)
    await selectors.openSearchEditor(page).click()
    await selectors.searchEditorVisibleRows(page).first().waitFor({ timeout: 90_000 })
    await step('opened')

    const header = await selectors
      .searchEditor(page)
      .locator(searchEditorFileRowSelector)
      .first()
      .textContent()
    const matches = Number(header?.match(/([\d,]+) matches/)?.[1]?.replaceAll(',', ''))
    ok(matches > 200, `The file needs over 200 matches, got: ${header}`)

    await selectors.searchEditor(page).evaluate((element) => {
      element.scrollTop = element.scrollHeight
    })
    await paintVisualSearch(page)
    await selectors.searchEditorVisibleRows(page).first().waitFor()
    await paintVisualSearch(page)
    await step('end-of-block')

    const geometry = await selectors.searchEditor(page).evaluate((element) => {
      const numbers = Array.from(element.querySelectorAll('[aria-hidden="true"] > span'))
        .map((span) => Number(span.textContent))
        .filter((value) => Number.isFinite(value) && value > 0)
      return { scrollHeight: element.scrollHeight, lastSourceLine: Math.max(0, ...numbers) }
    })
    inspections.set(page, { query: QUERY, file: FILE, matches, ...geometry })
    ok(
      geometry.scrollHeight >= matches * ROW_STRIDE,
      `Every match has a row: ${matches} matches need ${matches * ROW_STRIDE} px, the view is ${geometry.scrollHeight} px`,
    )
  },
  async inspect(page) {
    return inspections.get(page) ?? null
  },
}
