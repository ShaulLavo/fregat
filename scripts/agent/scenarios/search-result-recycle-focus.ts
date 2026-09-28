import { ok, strictEqual } from 'node:assert'
import { mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { openFixtureWorkspace, releaseFixture } from '../fixture-workspace'
import { scratchPath } from '../paths'
import {
  searchEditorGeometrySelectors,
  selectedEditorFileTabSelector,
  selectors,
} from '../selectors'
import type { Scenario } from './index'
import { paintVisualSearch, settledVisualSearch } from './visual-search-drive'

export const searchResultRecycleFocus: Scenario = {
  name: 'search-result-recycle-focus',
  description:
    'Focus a search excerpt, scroll until its editor is recycled, and verify Enter still opens the selected file.',
  async run(page, { step }) {
    const originalUrl = page.url()
    const fixture = await mkdtemp(scratchPath('fregat-search-recycle-focus-'))
    const firstFile = path.join(fixture, 'file-00.ts')
    try {
      await Promise.all(
        Array.from({ length: 80 }, (_, index) =>
          writeFile(
            path.join(fixture, `file-${String(index).padStart(2, '0')}.ts`),
            `export const result = 'recyclefocus ${index}'\n`,
          ),
        ),
      )
      await openFixtureWorkspace(page, fixture)
      await selectors.sidebarTab(page, 'Search').click()
      await selectors.workspaceSearch(page).fill('recyclefocus')
      await settledVisualSearch(page)
      await selectors.openSearchEditor(page).click()
      const row = selectors.searchEditorRowWithText(page, 'recyclefocus 0').first()
      await row.click()
      await paintVisualSearch(page)
      const slot = await row.evaluateHandle(
        (element, result) => element.closest(result),
        searchEditorGeometrySelectors.result,
      )
      const originalId = await slot.evaluate((element) => element?.id)
      ok(originalId)
      strictEqual(await slot.evaluate((element) => element?.contains(document.activeElement)), true)
      await step('excerpt-focused')

      await selectors.searchEditor(page).evaluate((element) => {
        element.scrollTop = 1600
      })
      await page.waitForFunction(
        ({ element, originalId }) => Boolean(element?.id && element.id !== originalId),
        { element: slot, originalId },
      )
      await paintVisualSearch(page)
      strictEqual(
        await selectors
          .searchEditor(page)
          .evaluate((element) => document.activeElement === element),
        true,
        'Recycling the focused editor returns focus to the search tree',
      )
      await step('recycled-editor-returned-focus')
      await page.keyboard.press('Enter')
      await page.waitForFunction(
        ({ selector, file }) =>
          document.querySelector(selector)?.getAttribute('data-editor-tab-path') === file,
        { selector: selectedEditorFileTabSelector, file: firstFile.slice(1) },
      )
      await step('original-selected-file-opened')
    } finally {
      await page.goto(originalUrl)
      await releaseFixture(fixture)
    }
  },
}
