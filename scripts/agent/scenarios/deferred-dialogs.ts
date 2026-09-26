import { strictEqual } from 'node:assert/strict'
import { selectors, waitForApp } from '../selectors'
import type { Scenario } from './index'

export const deferredDialogs: Scenario = {
  name: 'deferred-dialogs',
  description:
    'Delay dialog modules, retain palette typing, and cancel then reopen a loading picker.',
  async run(page, { step }) {
    const paletteRoute = '**/src/features/command-palette/components/content.tsx*'
    const pickerRoute = '**/src/components/file-picker-dialog.tsx*'
    const palette = Promise.withResolvers<void>()
    const picker = Promise.withResolvers<void>()
    await page.route(paletteRoute, async (route) => {
      await palette.promise
      await route.continue()
    })
    await page.route(pickerRoute, async (route) => {
      await picker.promise
      await route.continue()
    })
    try {
      await page.reload()
      await waitForApp(page)
      await page.keyboard.press('Control+Shift+P')
      await selectors.paletteLoading(page).waitFor()
      await selectors.paletteInput(page).fill('>settings')
      await step('palette-keeps-typing-while-loading')
      palette.resolve()
      await selectors.paletteLoading(page).waitFor({ state: 'hidden' })
      strictEqual(await selectors.paletteInput(page).inputValue(), '>settings')
      strictEqual(
        await selectors.paletteInput(page).evaluate((input) => input === document.activeElement),
        true,
      )
      await step('palette-loaded-with-search')
      await page.keyboard.press('Escape')

      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerLoading(page).waitFor()
      await step('picker-loading-can-close')
      await page.keyboard.press('Escape')
      await selectors.pickerLoading(page).waitFor({ state: 'hidden' })
      await selectors.projectMenu(page).click()
      await selectors.openFolderMenu(page).click()
      await selectors.pickerLoading(page).waitFor()
      picker.resolve()
      await selectors.pickerDialog(page).waitFor()
      await selectors.pickerSearch(page).waitFor()
      await step('picker-loaded-after-reopening')
      await page.keyboard.press('Escape')
    } finally {
      palette.resolve()
      picker.resolve()
      await page.unroute(paletteRoute)
      await page.unroute(pickerRoute)
    }
  },
}
