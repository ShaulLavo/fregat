import type { Scenario } from './index'
import { focusEditor, openFileByName } from '../selectors'

const TEXT = 'function burst() { return [1, 2, 3].map((n) => n * 2) }\n'

export const editorTypeBurst: Scenario = {
  name: 'editor-type-burst',
  description: 'Open a file and type 300 characters at 5ms per key, then undo.',
  async run(page, { file, step }) {
    await openFileByName(page, file)
    await step('opened')
    await focusEditor(page)
    await page.keyboard.press('Control+End')
    await page.keyboard.press('Enter')
    for (let i = 0; i < 5; i++) await page.keyboard.type(TEXT, { delay: 5 })
    await step('typed')
    for (let i = 0; i < 6; i++) await page.keyboard.press('Control+z')
    await step('undone')
  },
}
