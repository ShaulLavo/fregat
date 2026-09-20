import type { Scenario } from './index'
import { chords, selectors } from '../selectors'
import { createScriptError } from '../../structured-errors'

const PALETTE_STYLE = `document.getElementById('platform-palette')?.textContent ?? ''`

export const themeBundlePalette: Scenario = {
  name: 'theme-bundle-palette',
  description:
    'Open Choose theme, arrow through the bundles and watch the app palette repaint, then Escape and confirm the saved palette is back with nothing written.',
  async run(page, { step }) {
    const saved = await page.evaluate<string>(PALETTE_STYLE)
    await page.keyboard.press(chords.commandPalette)
    await selectors.paletteInput(page).fill('>Choose theme')
    await selectors.commandOption(page, 'Choose theme').first().click()
    await selectors.themeBundlePaletteOption(page).first().waitFor({ timeout: 20_000 })
    await step('palette-open')
    const seen = new Set<string>([saved])
    for (const label of ['first-preview', 'second-preview', 'third-preview']) {
      await page.keyboard.press('ArrowDown')
      await page.waitForTimeout(300)
      seen.add(await page.evaluate<string>(PALETTE_STYLE))
      await step(label)
    }
    if (seen.size < 3) throw createScriptError('Arrowing through the themes did not repaint.')
    await page.keyboard.press('Escape')
    await page.waitForFunction(`(${PALETTE_STYLE}) === ${JSON.stringify(saved)}`)
    await step('escaped-restored')
  },
}
