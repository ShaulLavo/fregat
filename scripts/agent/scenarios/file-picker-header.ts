import { ok } from 'node:assert/strict'
import type { Page } from 'playwright'
import { checkoutRoot } from '../paths'
import { writeUserOperations } from '../preserve-settings'
import { selectors } from '../selectors'
import type { Scenario } from './index'

async function checkHeader(page: Page, capturePath?: () => Promise<void>) {
  const dialog = await selectors.pickerDialog(page).boundingBox()
  const search = await selectors.pickerSearch(page).boundingBox()
  ok(dialog && search, 'The picker and its search field are visible')
  ok(search.width >= 180, 'Search keeps enough space to type')
  for (const view of ['Columns', 'List', 'Icons'] as const) {
    const tab = selectors.pickerView(page, view)
    if (!(await tab.isVisible())) continue
    const geometry = await selectors.pickerViewGeometry(page, view)
    ok(geometry.ownerRight, 'The view switcher and its tab are visible')
    ok(
      geometry.right <= geometry.ownerRight + 1,
      `${view} fits inside the view switcher: ${JSON.stringify(geometry)}`,
    )
    ok(geometry.right <= dialog.x + dialog.width, `${view} fits inside the picker`)
  }
  await selectors.pickerGoToFolder(page).click()
  const input = await selectors.pickerFolderPath(page).boundingBox()
  ok(input && input.width >= 160, 'Folder path entry keeps room for the path')
  await capturePath?.()
  await page.keyboard.press('Escape')
}

export const filePickerHeader: Scenario = {
  name: 'file-picker-header',
  requiresIsolatedServer: true,
  description:
    'Check picker search, path entry and view controls at phone, narrow and wide widths.',
  async run(page, { step }) {
    await selectors.projectMenu(page).click()
    await selectors.openFolderMenu(page).click()
    await selectors.pickerGoToFolder(page).click()
    await selectors.pickerFolderPath(page).fill(checkoutRoot)
    await page.keyboard.press('Enter')
    await selectors.pickerRow(page, 'apps').waitFor()
    for (const width of [1440, 720, 640, 900, 1024]) {
      await page.setViewportSize({ width, height: 1000 })
      await step(`header-${width}`)
      await checkHeader(page)
    }
    await writeUserOperations(page, [{ kind: 'set', key: 'workbench.colorTheme', value: 'dark' }])
    await selectors.colorModeRoot(page, 'dark').waitFor()
    await page.setViewportSize({ width: 720, height: 1000 })
    await step('header-dark-720')
    await checkHeader(page)
    await page.keyboard.press('Escape')
    await selectors.pickerDialog(page).waitFor({ state: 'hidden' })
    await page.setViewportSize({ width: 390, height: 1000 })
    await selectors.phoneAddProject(page).click()
    await selectors.pickerGoToFolder(page).waitFor()
    await step('header-390')
    await checkHeader(page, () => step('phone-path-entry'))
    await page.keyboard.press('Escape')
  },
}
