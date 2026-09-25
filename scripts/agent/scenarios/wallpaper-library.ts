import { preserveAppearance } from '../preserve-settings'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { chords, selectors, wallpaperStillSelector } from '../selectors'
import { createScriptError } from '../../structured-errors'

// Bytes no seed directory holds: a copy of an imported image would join that asset, not add one.
const UPLOAD_NAME = 'agent-scenario.png'
const UPLOAD = {
  name: UPLOAD_NAME,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAADAAAAAgCAIAAADbtmxLAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAASUlEQVRYhe2WAQkAQAwCF8VoRrnoH2PPOFgAET03NF/drCtAQdGhmiFsWdbxg2CMDtUMYcuyDiF80KJDNUPYssihCMY6HRwe1weCCwBbeEMuXAAAAABJRU5ErkJggg==',
    'base64',
  ),
}

async function openWallpaperTab(page: Page) {
  await selectors.themeStudioOpen(page).click()
  await selectors.themeStudio(page).waitFor()
  await selectors.themeStudioTab(page, 'Wallpaper').click()
}

export const wallpaperLibrary: Scenario = {
  name: 'wallpaper-library',
  description:
    'Open the theme studio from the settings Theme row, upload and delete an image on the Wallpaper tab, filter, select from the keyboard, Apply, and advance with Next wallpaper. Restores the previous selection.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page)
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('theme')
    await selectors.themeStudioOpen(page).waitFor()
    await step('settings-row')
    await openWallpaperTab(page)
    const cards = selectors.wallpaperCards(page)
    await cards.first().waitFor({ timeout: 20_000 })
    if ((await cards.count()) < 2)
      throw createScriptError('Import at least two library wallpapers before this scenario.')
    try {
      await step('wallpaper-tab')
      const ownsUpload = (await selectors.wallpaperCard(page, UPLOAD_NAME).count()) === 0
      if (ownsUpload) {
        await selectors.wallpaperUploadInput(page).setInputFiles(UPLOAD)
        await selectors
          .wallpaperCard(page, UPLOAD_NAME)
          .and(page.locator('[aria-pressed="true"]'))
          .waitFor({ timeout: 20_000 })
        await step('uploaded-and-selected')
      }
      await selectors.wallpaperFilter(page).fill('tokyo')
      await cards.first().focus()
      await page.keyboard.press('Enter')
      await step('filtered-keyboard-selection')
      await selectors.wallpaperFilter(page).fill('')
      await cards.nth(1).click()
      await step('second-selection')
      if (ownsUpload) {
        await selectors.wallpaperCard(page, UPLOAD_NAME).hover()
        await selectors.wallpaperActions(page, UPLOAD_NAME).click()
        await selectors.menuItem(page, 'Delete').click()
        await selectors.wallpaperCard(page, UPLOAD_NAME).waitFor({ state: 'detached' })
        await step('upload-deleted')
      }
      await selectors.themeStudio(page).getByRole('button', { name: 'Apply', exact: true }).click()
      await selectors.themeStudio(page).waitFor({ state: 'detached' })
      await page.keyboard.press('Escape')
      await selectors.wallpaperStill(page).waitFor()
      await step('workbench-wallpaper')
      const previous = await selectors.wallpaperStill(page).getAttribute('src')
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('>Next wallpaper')
      await selectors.commandOption(page, 'Next wallpaper').click()
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(wallpaperStillSelector)})?.getAttribute('src') !== ${JSON.stringify(previous)}`,
      )
      await step('next-wallpaper')
    } finally {
      await restore()
    }
    await step('restored')
  },
}
