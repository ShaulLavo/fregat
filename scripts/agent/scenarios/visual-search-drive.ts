import type { Page } from 'playwright'
import { openFileByName, selectors } from '../selectors'

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
