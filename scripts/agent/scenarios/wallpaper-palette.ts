import type { Scenario } from './index'
import { chords, selectors, wallpaperStillSelector } from '../selectors'
import { createScriptError } from '../../structured-errors'

export const wallpaperPalette: Scenario = {
  name: 'wallpaper-palette',
  description:
    'Open Choose wallpaper, arrow through rows and watch the workbench repaint, then Escape and confirm the saved wallpaper is back with nothing written.',
  async run(page, { step }) {
    await selectors.wallpaperStill(page).waitFor({ timeout: 20_000 })
    const saved = await selectors.wallpaperStill(page).getAttribute('src')
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('>Choose wallpaper')
    await selectors.commandOption(page, 'Choose wallpaper').click()
    await selectors.wallpaperPaletteOption(page, '').first().waitFor({ timeout: 20_000 })
    await step('palette-open')
    const seen = new Set<string | null>([saved])
    for (const label of ['first-preview', 'second-preview', 'third-preview']) {
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowDown')
      await page.waitForFunction(
        `document.querySelector(${JSON.stringify(wallpaperStillSelector)})?.complete === true`,
      )
      seen.add(await selectors.wallpaperStill(page).getAttribute('src'))
      await step(label)
    }
    if (seen.size < 3) throw createScriptError('Arrowing through the palette did not repaint.')
    await page.keyboard.press('Escape')
    await page.waitForFunction(
      `document.querySelector(${JSON.stringify(wallpaperStillSelector)})?.getAttribute('src') === ${JSON.stringify(saved)}`,
    )
    await step('escaped-restored')
  },
}
