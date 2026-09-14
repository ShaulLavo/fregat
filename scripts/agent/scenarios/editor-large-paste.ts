import type { Scenario } from './index'
import { focusEditor, openFileByName } from '../selectors'

const PASTE_LINES = 400
const PASTE_ROUNDS = 10

export const editorLargePaste: Scenario = {
  name: 'editor-large-paste',
  description: `Open a file, paste a ${PASTE_LINES}-line block ${PASTE_ROUNDS} times, undo twice.`,
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await step('opened')
    await focusEditor(page)
    await page.keyboard.press('Control+End')
    const block = Array.from(
      { length: PASTE_LINES },
      (_, i) => `const pasted${i} = ${i} // filler`,
    ).join('\n')
    for (let round = 0; round < PASTE_ROUNDS; round++) {
      await page.keyboard.insertText(block)
      await page.waitForTimeout(50)
    }
    await step('pasted')
    await page.keyboard.press('Control+z')
    await page.keyboard.press('Control+z')
    await step('undone')
  },
}
