import type { Scenario } from './index'
import { focusEditor, openFileByName } from '../selectors'

export const editorCaretBurst: Scenario = {
  name: 'editor-caret-burst',
  description: 'Move the caret 300 times within the first line without editing the document.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await focusEditor(page)
    await page.keyboard.press('Control+Home')
    await page.waitForTimeout(1500)
    await step('ready')
    for (let index = 0; index < 150; index++) {
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowLeft')
    }
    await step('moved')
  },
}
