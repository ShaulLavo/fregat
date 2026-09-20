import { strictEqual } from 'node:assert'
import type { Scenario } from './index'
import { focusEditor, openFileByName, selectors } from '../selectors'

const MESSY = 'const   formatChordSample   =   1'
const CHORDS = ['Alt+Shift+F', 'Control+Shift+F']

export const editorFormatChord: Scenario = {
  name: 'editor-format-chord',
  description:
    'Insert a badly spaced line, press each format chord, and check the line is rewritten.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.waitForTimeout(2500)
    for (const chord of CHORDS) {
      await page.keyboard.press('Control+End')
      await page.keyboard.insertText(`\n${MESSY}`)
      await page.waitForTimeout(1500)
      await page.keyboard.press(chord)
      await page.waitForTimeout(2500)
      const text = (await selectors.editorRows(page).allInnerTexts()).join('\n')
      console.log(`${chord}: messy line ${text.includes(MESSY) ? 'remains' : 'gone'}`)
      await step(chord)
      strictEqual(text.includes(MESSY), false, `${chord} formats the document`)
      await page.keyboard.press('Control+z')
      await page.keyboard.press('Control+z')
    }
    await step('restored')
  },
}
