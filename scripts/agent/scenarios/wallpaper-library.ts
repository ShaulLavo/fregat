import type { Scenario } from './index'
import { chords, selectors, wallpaperStillSelector } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const wallpaperLibrary: Scenario = {
  name: 'wallpaper-library',
  description:
    'Select separate light and dark library wallpapers, check keyboard focus, and advance the active wallpaper through the command palette.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    await selectors.settingsSearch(page).fill('wallpaper')
    await selectors.wallpaperPicker(page).waitFor()
    const cards = selectors.wallpaperCards(page)
    await cards.first().waitFor({ timeout: 20_000 })
    if ((await cards.count()) < 2)
      throw createScriptError('Import at least two library wallpapers before this scenario.')
    await selectors.wallpaperMode(page, 'Light').click()
    await cards.first().focus()
    await page.keyboard.press('Enter')
    await step('light-selection')
    await selectors.wallpaperMode(page, 'Dark').click()
    await cards.nth(1).focus()
    await page.keyboard.press('Enter')
    await step('dark-selection-keyboard')
    await page.keyboard.press('Escape')
    await selectors.wallpaperStill(page).waitFor()
    await step('workbench-wallpaper')
    const previous = await selectors.wallpaperStill(page).getAttribute('src')
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('>Next wallpaper')
    await selectors.commandOption(page, 'Next wallpaper').click()
    await selectors.wallpaperStill(page).waitFor()
    await page.waitForFunction(
      `document.querySelector(${JSON.stringify(wallpaperStillSelector)})?.getAttribute('src') !== ${JSON.stringify(previous)}`,
    )
    await step('next-wallpaper')
    for (const mode of ['Light', 'Dark']) {
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('>Choose light / dark mode')
      await selectors.commandOption(page, 'Choose light / dark mode').click()
      await selectors.colorModeOption(page, mode.toLowerCase()).click()
      await selectors.wallpaperStill(page).waitFor()
      await step(`${mode.toLowerCase()}-workbench`)
    }
  },
}
