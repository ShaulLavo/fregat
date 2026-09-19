import type { Scenario } from './index'
import { countBlankFrames } from '../blank-frames'
import { chords, selectors } from '../selectors'

/** Typing a file name must never flash the empty label or blank the list between keystrokes. */
export const quickOpenNoFlicker: Scenario = {
  name: 'quick-open-no-flicker',
  description: 'Type a file name one key at a time and count the frames that showed no rows.',
  async run(page, { step }) {
    await page.keyboard.press(chords.commandPalette)
    const input = selectors.paletteInput(page)
    await input.waitFor({ timeout: 5_000 })
    // The chord opens in commands mode; an empty input is file mode.
    await input.fill('')
    const blank = await countBlankFrames(page, selectors.paletteRowSelector, async () => {
      await page.keyboard.type('command-palette', { delay: 70 })
      await page.waitForTimeout(800)
    })
    await step(`blank-frames-${blank}`)
    await page.keyboard.press('Escape')
  },
}
