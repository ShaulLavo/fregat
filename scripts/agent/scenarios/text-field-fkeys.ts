import { strictEqual } from 'node:assert/strict'
import { chords, selectors } from '../selectors'
import type { Scenario } from './index'

export const textFieldFkeys: Scenario = {
  name: 'text-field-fkeys',
  description: 'F1 reopens the palette after Escape restores settings search; letters keep typing.',
  async run(page, { step }) {
    await page.keyboard.press('Control+,')
    const search = selectors.settingsSearch(page)
    await search.waitFor()
    await search.fill('')
    await search.press('x')
    strictEqual(await search.inputValue(), 'x')
    const palette = selectors.paletteInput(page)
    strictEqual(await palette.isVisible(), false)
    await step('letter-types-in-settings')

    await page.keyboard.press(chords.commandPalette)
    await palette.waitFor()
    await page.keyboard.press('Escape')
    await palette.waitFor({ state: 'hidden' })
    strictEqual(await search.evaluate((element) => element === document.activeElement), true)
    await step('escape-restores-settings-search')

    await page.keyboard.press('F1')
    await palette.waitFor({ timeout: 5000 })
    await step('f1-reopens-palette')
    await palette.fill('')
    await palette.press('x')
    strictEqual(await palette.inputValue(), 'x')
    await page.keyboard.press('F1')
    strictEqual(await palette.inputValue(), '>')
    await step('f1-switches-palette-to-commands')
    await page.keyboard.press('Escape')
  },
}
