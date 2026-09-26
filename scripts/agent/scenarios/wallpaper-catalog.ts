import { preserveAppearance } from '../preserve-settings'
import type { Scenario } from './index'
import { selectors } from '../selectors'

const THEME = 'catppuccin'
const FILE = '1-totoro.webp'

export const wallpaperCatalog: Scenario = {
  name: 'wallpaper-catalog',
  description:
    'Open the Wallpaper tab, filter to one Omarchy theme, pick a wallpaper that is still on GitHub, and wait for the download to land in the library as the selection. Restores the previous selection.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page)
    try {
      await page.keyboard.press('Control+,')
      await selectors.settingsSearch(page).fill('theme')
      await selectors.themeStudioOpen(page).click()
      await selectors.themeStudio(page).waitFor()
      await selectors.themeStudioTab(page, 'Wallpaper').click()
      const download = selectors.wallpaperCatalogCard(page, THEME, FILE)
      await download.waitFor({ timeout: 20_000 })
      await step('catalog-listed')
      await selectors.wallpaperFilter(page).fill(THEME)
      await step('catalog-filtered')
      await download.click()
      await selectors
        .wallpaperCard(page, `${THEME} · ${FILE}`)
        .and(page.locator('[aria-pressed="true"]'))
        .waitFor({ timeout: 60_000 })
      await step('downloaded-and-selected')
    } finally {
      await restore()
    }
  },
}
