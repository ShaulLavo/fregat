import { preserveAppearance } from '../preserve-settings'
import { strictEqual } from 'node:assert/strict'
import type { Page } from 'playwright'
import type { Scenario } from './index'
import { chords, selectors } from '../selectors'

async function command(page: Page, title: string) {
  await page.keyboard.press(chords.commandPalette)
  if (title === 'Light mode' || title === 'Dark mode') {
    await selectors.paletteInput(page).fill('>Choose light / dark mode')
    await selectors.commandOption(page, 'Choose light / dark mode').click()
    await selectors.colorModeOption(page, title === 'Light mode' ? 'light' : 'dark').click()
    await selectors.paletteInput(page).waitFor({ state: 'hidden' })
    return
  }
  await selectors.paletteInput(page).fill(`>${title}`)
  await selectors.commandOption(page, title).click()
  await selectors.paletteInput(page).waitFor({ state: 'hidden' })
}

export const wallpaperModeToggle: Scenario = {
  name: 'wallpaper-mode-toggle',
  description: 'Keep wallpaper off across color modes and restore the selected image on re-enable.',
  async run(page, { step }) {
    const restore = await preserveAppearance(page)
    try {
      await command(page, 'Light mode')
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('>Choose wallpaper')
      await selectors.commandOption(page, 'Choose wallpaper').click()
      const image = selectors.wallpaperLibraryOption(page).first()
      await image.waitFor()
      await image.click()
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await selectors.wallpaperStill(page).waitFor()
      const original = await selectors.wallpaperStill(page).getAttribute('src')
      await step('light-image-control')
      await command(page, 'Toggle wallpaper')
      await step('light-disabled')
      await command(page, 'Toggle wallpaper')
      await step('light-enabled-again')
      const restored = await selectors
        .wallpaperStill(page)
        .getAttribute('src', { timeout: 3000 })
        .catch(() => null)
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('>Choose wallpaper')
      await selectors.commandOption(page, 'Choose wallpaper').click()
      await selectors.wallpaperLibraryOption(page).first().click()
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await command(page, 'Dark mode')
      await page.keyboard.press(chords.commandPalette)
      await selectors.paletteInput(page).fill('>Choose wallpaper')
      await selectors.commandOption(page, 'Choose wallpaper').click()
      await selectors.wallpaperLibraryOption(page).first().click()
      await selectors.paletteInput(page).waitFor({ state: 'hidden' })
      await command(page, 'Toggle wallpaper')
      await step('dark-disabled')
      await command(page, 'Light mode')
      await step('light-after-disabled-dark')
      const visible = await selectors.wallpaperMedia(page).count()
      await page.reload()
      await selectors.windowToolbar(page).waitFor()
      await step('reload-still-disabled')
      const afterReload = await selectors.wallpaperMedia(page).count()
      console.log(
        JSON.stringify({ original, restored, visibleAfterModeSwitch: visible, afterReload }),
      )
      strictEqual(restored, original, 'Toggle wallpaper must restore the selected image')
      strictEqual(visible, 0, 'Switching color mode must keep wallpaper disabled')
      strictEqual(afterReload, 0, 'Reload must keep wallpaper disabled')
    } finally {
      await restore()
    }
  },
}
