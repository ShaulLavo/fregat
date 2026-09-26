import { chords, selectors } from '../selectors'
import type { Scenario } from './index'

export const quickOpenPreview: Scenario = {
  name: 'quick-open-preview',
  description:
    'Quick open previews the highlighted file under the results once the highlight rests, and follows the arrow keys.',
  async run(page, { step }) {
    await page.keyboard.press(chords.commandPalette)
    const input = selectors.paletteInput(page)
    await input.waitFor({ timeout: 5_000 })
    await input.fill('')
    await page.keyboard.type('lefthook.yml', { delay: 40 })
    await selectors.quickOpenPreview(page).locator('[data-file-preview-text]').waitFor()
    await step('previewed-file')
    await page.keyboard.press('Escape')
  },
}
