import type { Page } from 'playwright'
import { openFileByName, searchEditorSelector, selectors } from '../selectors'

export async function openVisualSearch(page: Page) {
  await openFileByName(page, 'README.md')
  await selectors.sidebarTab(page, 'Search').click()
  await selectors.workspaceSearch(page).fill('import')
  await selectors.searchSummary(page).first().waitFor({ timeout: 90_000 })
  await page.waitForFunction(() => !document.body.textContent?.includes('Searching'))
  await selectors.openSearchEditor(page).click()
  await selectors.searchEditorVisibleRows(page).first().waitFor()
}

export async function paintVisualSearch(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      }),
  )
}

export async function settledVisualSearch(page: Page) {
  await selectors.searchSummary(page).first().waitFor({ timeout: 90_000 })
  await page.waitForFunction(() => !document.body.textContent?.includes('Searching'), undefined, {
    timeout: 90_000,
  })
}

/** Rows are on screen and at least one carries syntax tokens. */
export async function paintedVisualSearch(page: Page) {
  await selectors.searchEditorVisibleRows(page).first().waitFor({ timeout: 90_000 })
  await paintVisualSearch(page)
  await page.waitForFunction(
    (selector) =>
      Array.from(CSS.highlights.entries())
        .filter(([name]) => name.startsWith('editor-shared-token-'))
        .some(([, highlight]) =>
          Array.from(highlight).some((range) =>
            range.startContainer.parentElement?.closest(selector),
          ),
        ),
    searchEditorSelector,
    { timeout: 90_000 },
  )
}
