import { strictEqual } from 'node:assert/strict'
import { selectors } from '../selectors'
import type { Scenario } from './index'

export const settingsFocus: Scenario = {
  name: 'settings-focus',
  description:
    'Switch Settings from JSON to the form without focusing search on phones; preserve desktop autofocus and explicit search input.',
  readOnly: true,
  capture: { width: 390, height: 844 },
  async run(page, { step }) {
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 })
      if (!(await selectors.settingsFormView(page).isVisible()))
        await selectors.settingsOpen(page).click()
      await selectors.settingsJsonView(page).click()
      await selectors.editorInput(page).first().waitFor()
      await step(`json-${width}`)
      await selectors.settingsFormView(page).click()
      const search = selectors.settingsSearch(page)
      await search.waitFor()
      await step(`form-${width}`)
      strictEqual(
        await search.evaluate((element) => element === document.activeElement),
        width >= 768,
        `Switching to the Settings form at ${width}px must only autofocus search on desktop`,
      )
      await search.click()
      strictEqual(
        await search.evaluate((element) => element === document.activeElement),
        true,
        'Explicitly selecting search must still focus it',
      )
      await search.fill('font')
      await step(`search-${width}`)
      await search.clear()
    }
  },
}
