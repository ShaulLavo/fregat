import type { Scenario } from './index'
import { selectors } from '../selectors'

export const themeGallery: Scenario = {
  name: 'theme-gallery',
  description: 'Inspect the bundle gallery and both variant editors without saving.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('Theme bundles')
    await selectors.themeGallery(page).waitFor()
    await page.waitForTimeout(500)
    await step('gallery')
    await selectors.themeAction(page, 'New from current').click()
    await selectors.themeEditor(page).waitFor()
    await page.waitForTimeout(300)
    await step('light-editor')
    await selectors.themeAction(page, 'Dark version').click()
    await step('dark-editor')
    await selectors.themeAction(page, 'Cancel').click()
  },
}
